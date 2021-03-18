import fetch from 'node-fetch';
import CompilationService from './CompilationService'
import { Collection } from 'discord.js'
import log from '../../log';
import { runInThisContext } from 'vm';
var rp = require('request-promise');
const fs = require('fs');
const extract = require('extract-zip')
const path = require('path');

const cacheFolder = "cache/";
const challengesFolder = cacheFolder + "challenges/";
const githubRepos = [
    // ["nikclayton",       "edabit-javascript-challenges"],
    ["IronCPlusPlus",       "Prog-Racer-Challenges"],
];

const difficultLevels = new Collection([ ['beginner', 0], ['easy', 1], ['medium', 2], ['hard', 3], ['very-hard', 4], ['expert', 5] ]);

// Dynamically loading Objects.
const isDirectory = source => fs.lstatSync(source).isDirectory();
const isFile = source => !fs.lstatSync(source).isDirectory();
const getDirectories = source => fs.readdirSync(source).map(name => path.join(source, name)).filter(isDirectory);
const getFilesInDirectory = source => fs.readdirSync(source).map(name => path.join(source, name)).filter(isFile);

const languageFileTypes = {
    'c++' : ['cpp'],
    'cpp' : ['cpp'],
    'javascript' : ['js'],
}
const languageFileTypesReversed = {}
for (const key in languageFileTypes) {
    const element = languageFileTypes[key];

    for (let index = 0; index < element.length; index++) {
        const extension = element[index];
        if (languageFileTypesReversed[extension] == undefined)
            languageFileTypesReversed[extension] = [];
        languageFileTypesReversed[extension].push(key);
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}   

/**
 * A class designed to fetch & hold the list of valid
 * challenges into a catalog.
 * 
 * @extends {CompilationService}
 */
export class ChallengeCatalog extends CompilationService {
    /**
     * Creates a Compilers object.
     *
     * @param {CompilerClient} client compiler client
     */
    constructor(client) {
        super(client);
        this.difficultLevels = difficultLevels;
        this.templates = {};
    }
    
    /**
     * 
     * @param {Number} level 
     * @return {Array<Challenge>}
     */
    get(level)
    {
        return super.get(level);
    }

    /**
     * 
     * @param {String} userCode 
     * @param {String} lang 
     * @return {String}
     */
    generateCode(userCode, tests, language)
    {
        if (languageFileTypes[language] == undefined)
        {
            log.error("Langauge `" + language + "` not supported for Generating Code!");
            return null;
        }

        var template = '' + this.templates[language];
        template = template.replace('{__TESTS__}', tests.join(" && "));
        template = template.replace('{__USERGEN__}', userCode);

        return template;
    }

    /**
     * 
     * @param {Number} level 
     * @param {String} language 
     * @return {Challenge}
     */
    getRandom(level, language)
    {
        if (level == undefined || !this.has(level))
            level = this.firstKey(); 
        
        if (language == undefined)
            return super.get(level).random();

        var levelArray = this.get(level);
        if (levelArray == undefined)
        {
            console.error("Level", level, "doesn't have any indices?", this.keyArray());
            return null;
        }
        var collectedInLanguage = [];
        for (let challengeIndex = 0; challengeIndex < levelArray.length; challengeIndex++) {
            const challenge = levelArray[challengeIndex];
            if (challenge.languages.some((lang) => lang === language))
            {
                collectedInLanguage.push(challenge);
            }
        }
        if (collectedInLanguage.length == 0)
            return null;
        return collectedInLanguage[Math.round(Math.random() * (collectedInLanguage.length - 1))];
    }

    async DownloadChallengesFromGithub()
    {
        if (!fs.existsSync(challengesFolder))
        {
            await fs.mkdir(challengesFolder, { recursive: true }, (err) => { if (err) log.error(err); });
        }

        for (let repoIndex = 0; repoIndex < githubRepos.length; repoIndex++) {
            const repo = githubRepos[repoIndex];

            const userRepo = repo[0]; const repoTarget = repo[1];

            const fileName = 'github-'+userRepo+'-'+ repoTarget;
            const fileNameZip = cacheFolder + fileName + '.zip';
            const url = "https://api.github.com/repos/"+ userRepo + "/" + repoTarget + "/zipball/";

            if (fs.existsSync(challengesFolder + fileName))
            {
                log.info("Pulling " + userRepo + "/" + repoTarget + " from [CACHE]");
                continue;
            }

            try
            {
                log.info("Pulling " + userRepo + "/" + repoTarget + " from [GIT]");
                var binaryDownload = await rp(url, {
                    encoding: null,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36'
                    }
                });
                
                await fs.writeFile(fileNameZip, binaryDownload, (err) => { if (err) log.error(err); });
                
                try {
                    await extract(fileNameZip, { dir: path.join(process.cwd(), challengesFolder + fileName) })
                    log.info('Completed Extracting ' + userRepo + "/" + repoTarget)
                } catch (err) {
                    log.error("Zip Extraction Exception " + userRepo + "/" + repoTarget + " ::> " + err);
                }
            }
            catch (err)
            {
                log.error("Download URL Exception: " + url + " ::> " + err);
            }
        }
    }

    async LoadChallengeJson(filePath)
    {
        const challengeReadFile = fs.readFileSync(filePath);
        const challengeJson = JSON.parse(challengeReadFile);
        var level = 0;

        if (challengeJson.difficulty != undefined && difficultLevels.has(challengeJson.difficulty.replace(' ', '-').toLowerCase()))
        {
            level = difficultLevels.get(challengeJson.difficulty.replace(' ', '-').toLowerCase());
        }

        if (!this.has(level))
            this.set(level, []);
        
        this.get(level).push(new Challenge(challengeJson.title, challengeJson.tags, Object.keys(challengeJson.tests), level, challengeJson.difficulty, challengeJson.instructions, challengeJson.tests, challengeJson.hints));
    }

    async LoadChallenges(path)
    {
        var isRoot = (path == undefined);
        if (isRoot)
            path = challengesFolder;

        var challengeDirectories = getDirectories(path);
        var fileSearches = getFilesInDirectory(path);
        for (let challengeIndex = 0; challengeIndex < challengeDirectories.length; challengeIndex++) {
            const challengeCollection = challengeDirectories[challengeIndex];
            
            var files = getFilesInDirectory(challengeCollection);
            if (files.length == 0 || !files.some((file) => { return file.endsWith('challenge.json'); }))
            {
                var recursiveDirectories = getDirectories(challengeCollection);
                for (let recurseDirectoryIndex = 0; recurseDirectoryIndex < recursiveDirectories.length; recurseDirectoryIndex++) {
                    const recurseDirectory = recursiveDirectories[recurseDirectoryIndex];
                    await this.LoadChallenges(recurseDirectory);
                }
            }
        }

        for (let fileIndex = 0; fileIndex < fileSearches.length; fileIndex++) {
            const file = fileSearches[fileIndex];
            if (file.endsWith('challenge.json'))
            {
                await this.LoadChallengeJson(file, 0);
            }
        }
    }

    /**
     * Asyncronously fetches the list of valid languages and populates our cache.
     * Note: This can throw
     */
    async initialize() {
        await this.DownloadChallengesFromGithub();
        await this.LoadChallenges();

        var challengeAmt = 0;
        for (let challengeIndex = 0; challengeIndex < this.keyArray().length; challengeIndex++) {
            const challengeLevel = this.keyArray()[challengeIndex];
            challengeAmt += this.get(challengeLevel).length;
        }
        
        var templateFiles = getFilesInDirectory("templates");
        for (let fileIndex = 0; fileIndex < templateFiles.length; fileIndex++) {
            const file = templateFiles[fileIndex];
            var extension = file.split('.')
            extension = extension[extension.length - 1];
            
            const languageExtensions = languageFileTypesReversed[extension];
            if (languageExtensions == undefined)
                continue;

            for (let index = 0; index < languageExtensions.length; index++) {
                const language = languageExtensions[index];
                this.templates[language] = fs.readFileSync(file).toString('utf-8');
            }
        }

        log.info("Loaded : " + this.keyArray().length + " Challenge Levels");
        log.info("Loaded : " + challengeAmt + " Challenges");
        
        // dont emit under testing conditions
        if (this.client)
            this.client.emit('challengeCatalogReady');
    }
}

export class Challenge
{
    constructor(name, tags, languages, level, levelName, description, expectedOutputs, hints, caseSensitive)
    {
        this.name = name;
        this.tags = tags;
        this.languages = languages;
        this.level = level;
        this.levelName = levelName;
        this.description = description;
        this.expectedOutputs = expectedOutputs;
        this.hints = hints;
        this.caseSensitive = (caseSensitive == undefined ? true : false); // default is true.
    }
}