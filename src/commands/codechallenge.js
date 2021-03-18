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
            const level = Number.isSafeInteger(args[1]) ? Number(args[1]) : undefined;
    
            if (!this.client.wandbox.has(lang)) {
                msg.replyFail(`You must input a valid language \n\n Usage: ${this.client.prefix}challenge <language>`);
                return;
            }
            
            await msg.message.delete();
    
            return await this.LoadRandomQuestion(msg, undefined, level, lang);
        }
        catch (err)
        {
            console.error(err);
            throw(err);
        }
    }

    async LoadRandomQuestion(msg, previousMessage, level, lang, tries)
    {
        if (tries == undefined)
            tries = 0;

        if (previousMessage == undefined)
        {
            const embed = new MessageEmbed()
                    .setTitle('Finding Coding Challenge')
                    .setDescription(`*Searching Catalogs*`)
                    .setColor(0x444444)
                    .setThumbnail('https://imgur.com/TNzxfMB.png')
                    .setFooter(`Requested by: ${msg.message.author.tag}`)
            previousMessage = await msg.dispatch('', embed);
            
            await sleep(500); // Maybe remove this?
        }

        if (level == undefined)
            level = Math.round(Math.random() * (this.client.challengeCatalog.keyArray().length - 1));
        
        var randomChallenge = this.client.challengeCatalog.getRandom(level, lang);
        if (msg.lastQuestion == randomChallenge.name && tries <= 3)
        {
            tries++;
            return await this.LoadRandomQuestion(msg, previousMessage, level, lang, tries);
        }
        
        msg.lastQuestion = randomChallenge.name;
        return await this.LoadQuestion(randomChallenge, msg, previousMessage, level, lang);
    }

    async LoadQuestion(randomChallenge, msg, previousMessage, level, lang)
    {
        if (randomChallenge == undefined)
        {
            if (previousMessage && !previousMessage.deleted)
            {
                await previousMessage.delete();
            }
            return await msg.replyFail("Couldn't find any challenges regarding `"+ lang +"` for level `"+ level +"`, sorry!");
        }

        var decodedDescription = randomChallenge.description[lang];
        if (decodedDescription == undefined)
            decodedDescription = randomChallenge.description['*']
        if (decodedDescription == undefined)
        {
            if (previousMessage && !previousMessage.deleted)
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

        var tags = "";
        if (randomChallenge.tags != undefined)
        {
            for (let tagIndex = 0; tagIndex < randomChallenge.tags.length; tagIndex++) {
                const tagElement = randomChallenge.tags[tagIndex];
                tags += "`"+tagElement+"` ";
            }
        }

        const expirationTimeSecs = 5 * 60;
        const challengeEmbed = new MessageEmbed()
            .setTitle(randomChallenge.name)
            .addField("Language", lang)
            .addField("Tags", tags)
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

        const reaction_filter = (reaction, user) => { return user.id === msg.message.author.id; };
        
        var hintMessages = [];

        // Grabs the language or the all, if neither exist then there's no hints.
        
        var hints = undefined;
        if (randomChallenge.hints != undefined)
        {
            hints = randomChallenge.hints[lang];
            hints = hints == undefined ? randomChallenge.hints['*'] : hints;
            if (hints != undefined)
                hints = hints.reverse();
        }

        var hintsLeft = hints == undefined ? 0 : hints.length;

        async function setupReactions(self)
        {
            if (hintsLeft > 0)
            {
                await previousMessage.react('❓');
            }
            await previousMessage.react('❌');
            await previousMessage.react('▶');

            // We want this to run in parallel of another await.
            previousMessage.awaitReactions(reaction_filter, { max: 1, time: 1000 * expirationTimeSecs, errors: ['time'] })
            .then(async collected => {
                const reaction = collected.first();

                if (reaction.emoji.name === '❓') 
                {
                    // Todo :: Change to modern reply.
                    var tmpHintMsg = await previousMessage.reply(hints[hintsLeft - 1]);
                    hintMessages.push(tmpHintMsg);
                    
                    // Hint Used
                    previousMessage.reactions.removeAll().catch(error => console.error('Failed to clear reactions: ', error));  

                    hintsLeft--;
                    
                    // Update
                    await setupReactions();
                } 
                else if (reaction.emoji.name === '❌') 
                {
                    for (let index = 0; index < hintMessages.length; index++) {
                        const hintMsg = hintMessages[index];
                        if (!hintMsg.deleted)
                            hintMsg.delete();
                    }
                    if (previousMessage && !previousMessage.deleted)
                        await previousMessage.delete();
                } 
                else if (reaction.emoji.name === '▶') 
                {
                    if (previousMessage && !previousMessage.deleted)
                        await previousMessage.delete();
                    await self.LoadRandomQuestion(msg, undefined, level, lang);
                }
            })
            .catch(err => console.error("Unexpected error at awaiting Reactions from Questionaire:", err))
        }
        await setupReactions(this);

        const code_filter = m => m.author.id === msg.message.author.id;
        var userAnswerMsgs = undefined;
        try
        {
            userAnswerMsgs = await previousMessage.channel.awaitMessages(code_filter, { max: 1, time: 1000 * expirationTimeSecs, errors: ['time'] });
        }
        catch (err)
        {
            log.error("Unexpected Error at awaiting user Answer Msg:", err);
            if (previousMessage.deleted)
            {
                console.error("Attempted to interact with something deleted!");
                return null;
            }

            previousMessage.reactions.removeAll().catch(error => console.error('Failed to clear reactions: ', error));
            return await msg.replyFail('Question Timeout');
        }

        if (previousMessage.deleted)
        {
            console.error("Attempted to interact with something deleted!");
            return null;
        }
        
        const userAnswerMsg = userAnswerMsgs.first();
        var userAnswer = '' + userAnswerMsg.content;
        var userAnswerStart = userAnswer.indexOf('\n');
        
        var safeUserAnswer = userAnswer.startsWith('```') ? userAnswer.substring( userAnswerStart, userAnswer.length) : userAnswer;
        safeUserAnswer = safeUserAnswer.endsWith('```') ? safeUserAnswer.substring(0, safeUserAnswer.length - 3) : safeUserAnswer;
        
        const languageExpectations = randomChallenge.expectedOutputs[lang];

        const generatedCode = this.client.challengeCatalog.generateCode(safeUserAnswer, languageExpectations, lang);
        if (generatedCode == undefined)
        {
            log.error('Failed to Generated User Code; `ASSERT('+thisline+') generatedCode == undefined`');
            var thisline = new Error().lineNumber;
            return await msg.replyFail('Failed to Generated User Code; `ASSERT('+thisline+') generatedCode == undefined`');
        }
        userAnswerMsg.content = "```" + generatedCode + "```";
        
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
                if (!previousMessage.deleted)
                {
                    return msg.replyFail(`Could not retrieve code from url \n ${e.message}`);
                }
            }
        }
        // Standard ``` <code> ``` request
        else {
            code = parser.getCodeBlockFromText();
            if (code) {
                code = CompilationParser.cleanLanguageSpecifier(code);
            }
            else {
                if (!previousMessage.deleted)
                {
                    return msg.replyFail('You must attach codeblocks containing code to your message');
                }
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
                return await msg.replyFail(`Failed to react to message, am I missing permissions?\n${e}`);
            }    
        }

        let json = null;
        try {
            json = await setup.compile();
        }
        catch (e) {
            return await msg.replyFail(`Wandbox request failure \n ${e.message} \nPlease try again later`);
        }
        if (!json) {
            
            return await msg.replyFail(`Invalid Wandbox response \nPlease try again later`);
        }
        //remove our react
        if (reactionSuccess && this.client.loading_emote) {
            try {
                await msg.message.reactions.resolve(this.client.loading_emote).users.remove(this.client.user);
            }
            catch (error) {
                return await msg.replyFail(`Unable to remove reactions, am I missing permissions?\n${error}`);
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
                await responsemsg.react('🚫');
                await responsemsg.react('▶');
            }
            catch (error) {
                return await msg.replyFail(`Unable to react to message, am I missing permissions?\n${error}`);
            }

            // Succeeded! Give Experience points to the user.
            // Do something..
        }
        else
        {
            if (randomChallenge)
            {
                try {
                    await responsemsg.react('🚫');
                    await responsemsg.react('🔁');
                    await responsemsg.react('▶');
                }
                catch (error) {
                    return msg.replyFail(`Unable to react to message, am I missing permissions?\n${error}`);
                }
            }
        }
        // Create a reaction collector
        const emojifilter = (reaction, user) => (reaction.emoji.name === '🚫' ||  reaction.emoji.name === '🔁' || reaction.emoji.name == '▶') && user.id === msg.message.author.id
        try
        {
            const collectionReactions = await responsemsg.awaitReactions(emojifilter, { max: 1, time: 30 * 1000 });
            const reaction = collectionReactions.first();
            await responsemsg.reactions.removeAll();

            if (reaction.emoji.name == '🔁')
            {
                await this.LoadQuestion(randomChallenge, msg, undefined, level, lang);
            }
            else if (reaction.emoji.name == '🚫')
            {
                return; // We are done here...
            }
            else if (reaction.emoji.name == '▶')
            {
                await this.LoadRandomQuestion(msg, undefined, level, lang);
            }
        }
        catch (err)
        {
            responsemsg.reactions.removeAll();
            let embed = ChallengeCommand.buildResponseEmbed(msg, json, lang, true);
            responsemsg.edit('', embed);
        }
        
        return previousMessage;
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
