import { Collection, MessageEmbed } from 'discord.js'

import CompilerCommand from './utils/CompilerCommand'
import CompilerCommandMessage from './utils/CompilerCommandMessage'
import CompilerClient from '../CompilerClient'
import log from '../log';
import CompilationParser from './utils/CompilationParser';
import { WandboxSetup } from '../utils/apis/Wandbox';
import SupportServer from '../SupportServer';
import CompileCommand from './compile';
import stripAnsi from 'strip-ansi';

const sanitizeHTML = require('sanitize-html');

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}   

export default class ChallengeCommand extends CompilerCommand {
    /**
     *  Creates the challenge command
     * 
     * @param {CompilerClient} client
     */
    constructor(client) {
        super(client, {
            name: 'challenge',
            description: 'Find a Code Challenge for my level!',
            developerOnly: false
        });
    }

    /**
     * Function which is executed when the command is requested by a user
     *
     * @param {CompilerCommandMessage} msg
     */
    async run(msg) {
        try
        {
            let args = msg.getArgs();
        
            if (args.length < 1) 
            {
                return await this.help(msg);
            }
    
            var lang = args[0].toLowerCase();
            if (lang == 'cpp') lang = 'c++'; // Save everyone the head-ache.
            args.shift();
            const level = Number.isSafeInteger(args[0]) ? Number(args[0]) : undefined;
    
            if (!this.client.wandbox.has(lang)) {
                msg.replyFail(`You must input a valid language \n\n Usage: ${this.client.prefix}challenge <language>`);
                return;
            }
    
            const embed = new MessageEmbed()
                .setTitle('Finding Coding Challenge')
                .setDescription(`*Searching Catalogs*`)
                .setColor(0x444444)
                .setThumbnail('https://imgur.com/TNzxfMB.png')
                .setFooter(`Requested by: ${msg.message.author.tag}`)
            const compiledMessage = await msg.dispatch('', embed);
            
            await sleep(500); // Maybe remove this?
    
            await this.LoadRandomQuestion(msg, compiledMessage, level, lang);
    
            return compiledMessage;
        }
        catch (err)
        {
            console.error(err);
            throw(err);
        }
    }

    async LoadRandomQuestion(msg, previousMessage, level, lang)
    {
        if (level == undefined)
            level = Math.round(Math.random() * this.client.challengeCatalog.keyArray().length);
        
        var randomChallenge = this.client.challengeCatalog.getRandom(level, lang);

        return await this.LoadQuestion(randomChallenge, msg, previousMessage, level, lang);
    }

    async LoadQuestion(randomChallenge, msg, previousMessage, level, lang)
    {
        if (randomChallenge == undefined)
        {
            if (previousMessage)
            {
                await previousMessage.delete();
            }
            return await msg.replyFail("Couldn't find any challenges regarding `"+ lang +"` for level `"+ level +"`, sorry!");
        }

        var decodedDescription = randomChallenge.description[lang];
        if (decodedDescription == undefined)
        {
            if (previousMessage)
            {
                await previousMessage.delete();
            }
            return await msg.replyFail("Failed loading `"+ randomChallenge.name +"`, description couldn't be loaded on language `"+ lang +"`");
        }

        if (Array.isArray(decodedDescription))
            decodedDescription = decodedDescription.join('\n');

        decodedDescription = decodedDescription.replace(/<code>/g, "```");
        decodedDescription = decodedDescription.replace(/<\/code>/g, "```");
        decodedDescription = decodedDescription.replace(/(<([^>]+)>)/ig, "");
        decodedDescription = sanitizeHTML(decodedDescription);

        const expirationTimeSecs = 5 * 60;
        const challengeEmbed = new MessageEmbed()
            .setTitle(randomChallenge.name)
            .addField("Language", lang)
            .addField("Level", randomChallenge.level + " ("+ randomChallenge.levelName +")")
            .addField("Instructions", decodedDescription)
            .addField("How to Answer?", "Next set of Input will take your answer! Remember to put code blocks around your code!")
            .addField("Expiration", (expirationTimeSecs / 60) + " Minutes")
            .setColor(0x00FF00)
            .setThumbnail('https://imgur.com/TNzxfMB.png')
            .setFooter(`Requested by: ${msg.message.author.tag}`)
            
        if (previousMessage)
        {
            await previousMessage.edit('', challengeEmbed);
        }
        else
        {
            previousMessage = await msg.dispatch('', challengeEmbed);
        }

        const filter = m => m.author.id === msg.message.author.id;
        var userAnswerMsgs = undefined;
        try
        {
            userAnswerMsgs = await previousMessage.channel.awaitMessages(filter, { max: 1, time: 1000 * expirationTimeSecs, errors: ['time'] });
        }
        catch (err)
        {
            return await msg.replyFail('Question Timeout');
        }

        const userAnswerMsg = userAnswerMsgs.first();
        var userAnswer = userAnswerMsg.content;
        var safeUserAnswer = userAnswer.endsWith('```') ? userAnswer.substring(0, userAnswer.length - 3) : userAnswer;

        // User answer currently is used as the answer point to expected outputs;
        // But soon...
        // The User Answer should be a function/class that can be called upon and the expected outputs would run it's hidden tests on it.
        // Essentially User never writes the int main() { return 0; } example for cpp.

        const languageExpectations = randomChallenge.expectedOutputs[lang];

        userAnswerMsg.content = safeUserAnswer
        +"\n\n// Generated Test Code\n"+
        languageExpectations[0]
        +"\n```";
        
        const tempCompilerMsg = new CompilerCommandMessage(userAnswerMsg);
        let parser = new CompilationParser(tempCompilerMsg);

        const argsData = parser.parseArguments();
        let code = null;
        // URL request needed to retrieve code
        if (userAnswerMsg.attachments.keyArray().length > 0) {
            try {
                code = await CompilationParser.getCodeFromURL(userAnswerMsg.attachments.first().url);
            }
            catch (e) {
                return msg.replyFail(`Could not retrieve code from url \n ${e.message}`);
            }
        }
        // Standard ``` <code> ``` request
        else {
            code = parser.getCodeBlockFromText();
            if (code) {
                code = CompilationParser.cleanLanguageSpecifier(code);
            }
            else {
                return msg.replyFail('You must attach codeblocks containing code to your message');
            }
            /*
            const stdinblock = parser.getStdinBlockFromText();
            if (stdinblock) {
                argsData.stdin = stdinblock;
            }
            */
        }

        let setup = new WandboxSetup(code, lang, '', true, '', this.client.wandbox);
        setup.fix(this.client.fixer); // can we recover a failed compilation?

        let reactionSuccess = false;
        if (this.client.loading_emote)
        {
            try {
                await msg.message.react(this.client.loading_emote);
                reactionSuccess = true;
            }
            catch (e) {
                msg.replyFail(`Failed to react to message, am I missing permissions?\n${e}`);
            }    
        }

        let json = null;
        try {
            json = await setup.compile();
        }
        catch (e) {
            msg.replyFail(`Wandbox request failure \n ${e.message} \nPlease try again later`);
            return;
        }
        if (!json) {
            msg.replyFail(`Invalid Wandbox response \nPlease try again later`);
            return;
        }

        //remove our react
        if (reactionSuccess && this.client.loading_emote) {
            try {
                await msg.message.reactions.resolve(this.client.loading_emote).users.remove(this.client.user);
            }
            catch (error) {
                msg.replyFail(`Unable to remove reactions, am I missing permissions?\n${error}`);
            }
        }   

        SupportServer.postCompilation(code, lang, json.url, msg.message.author, msg.message.guild, json.status == 0, json.compiler_message, this.client.compile_log, this.client.token);

        let embed = ChallengeCommand.buildResponseEmbed(msg, json, lang);
        let responsemsg = await msg.dispatch('', embed);
        
        if (this.client.shouldTrackStats())
            this.client.stats.compilationExecuted(lang, embed.color == 0xFF0000);

        if (json.status == 0)
        {
            try {
                responsemsg.react('🚫');
                responsemsg.react('▶');
            }
            catch (error) {
                msg.replyFail(`Unable to react to message, am I missing permissions?\n${error}`);
                return;
            }

            // Succeeded! Give Experience points to the user.
            // Do something..
        }
        else
        {
            if (randomChallenge)
            {
                try {
                    responsemsg.react('🚫');
                    responsemsg.react('🔁');
                    responsemsg.react('▶');
                }
                catch (error) {
                    msg.replyFail(`Unable to react to message, am I missing permissions?\n${error}`);
                    return;
                }
            }
        }

        // Create a reaction collector
        console.log("Waiting for", msg.message.author.id);
        const emojifilter = (reaction, user) => (reaction.emoji.name === '🚫' ||  reaction.emoji.name === '🔁' || reaction.emoji.name == '▶') && user.id === msg.message.author.id
        try
        {
            const collectionReactions = await responsemsg.awaitReactions(emojifilter, { max: 1, time: 30 * 1000 });
            const reaction = collectionReactions.first();
            responsemsg.reactions.removeAll();

            console.log("Response from user", msg.message.author.id, reaction.emoji.name);
            if (reaction.emoji.name == '🔁')
            {
                console.log("Restarting Question!");
                await this.LoadQuestion(randomChallenge, msg, undefined, level, lang);
            }
            else if (reaction.emoji.name == '🚫')
            {
                return; // We are done here...
            }
            else if (reaction.emoji.name == '▶')
            {
                console.log("Starting new Random Question!");
                await this.LoadRandomQuestion(msg, undefined, level, lang);
            }
        }
        catch (err)
        {
            responsemsg.reactions.removeAll();
            let embed = ChallengeCommand.buildResponseEmbed(msg, json, lang, true);
            responsemsg.edit('', embed);
        }
    }

    /**
     * Builds a compilation response embed
     * 
     * @param {CompilerCommandMessage} msg 
     * @param {*} json 
     */
    static buildResponseEmbed(msg, json, lang, withoutRetry) {
        const embed = new MessageEmbed()
        .setTitle('Compilation Results:')
        .setFooter("Requested by: " + msg.message.author.tag + " || Powered by wandbox.org")
        .setColor(0x00FF00);

        if (json.status) {
            if (json.status != 0) { // Failure
                embed.setColor((0xFF0000));

                if (json.compiler_message) {
                    if (json.compiler_message.length >= 1017) {
                        json.compiler_message = json.compiler_message.substring(0, 1016);
                    }
                    /**
                     * Certain compiler outputs use unicode control characters that
                     * make the user experience look nice (colors, etc). This ruins
                     * the look of the compiler messages in discord, so we strip them
                     * out with stripAnsi()
                     */
                    json.compiler_message = stripAnsi(json.compiler_message);
                    embed.addField('Compiler Output', `\`\`\`${json.compiler_message}\n\`\`\`\n`);
                }
        
                if (json.program_message) {
                    /**
                     * Annoyingly, people can print '`' chars and ruin the formatting of our
                     * program output. To counteract this, we can place a unicode zero-width
                     * character to escape it.
                     */
                    json.program_message = json.program_message.replace(/`/g, "\u200B"+'`');
        
                    if (json.program_message.length >= 1016) {
                        json.program_message = json.program_message.substring(0, 1015);
                    }
        
                    json.program_message = stripAnsi(json.program_message);
        
                    embed.addField('Program Output', `\`\`\`\n${json.program_message}\n\`\`\``);
                }

                if (!withoutRetry)
                {
                    embed.addField("Incorrect!", "If you like to retry press the 🔁, or you can hit the 🚫 or wait for this to timeout to move along.\nUnless you like to try a different challenge hit ▶");
                }
            }
            else { // Success
                embed.setColor(0x00FF00);  
                embed.addField('Congratuations!', "You have completed this challenge, try another challenge by doing `;challange "+ lang +"`\nIf you like to try another challenge hit ▶")
            }
            embed.addField('Status code', `Finished with exit code: ${json.status}`);  
        }

        // Global
        if (json.signal) {
            embed.addField('Signal', `\`\`\`${json.signal}\`\`\``);
        }

        if (json.url) {
            embed.addField('URL', `Link: ${json.url}`);
        }
        
        return embed;
    }
    
    /**
     * Displays the help information for the given command
     *
     * @param {CompilerCommandMessage} message
     */
    async help(message) {
        const embed = new MessageEmbed()
            .setTitle('Command Usage')
            .setDescription(`*${this.description}*`)
            .setColor(0x00FF00)
            .addField('Challenge', `${this.toString()} <language>`)
            .addField('Challenge w/ Level Specific', `${this.toString()} <language> <level>`)
            .setThumbnail('https://imgur.com/TNzxfMB.png')
            .setFooter(`Requested by: ${message.message.author.tag}`)
        return await message.dispatch('', embed);
    }
}
