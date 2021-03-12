import Discord from "discord.js";
import { dirname as pathDirname, join as pathJoin } from "path";
import readdirp from "readdirp";
import yargs from "yargs";
import Command from "./Command";
import { HelpSettings, init as HelpInit } from "./HelpCommand";
import * as reaction from "./reaction";
import * as logging from "./Logging";

export default class Handler {
    readonly client: Discord.Client;
    commands: Commands;
    commandsDir: string;
    listening: boolean;
    opts: HandlerOpions;
    logger?: logging.Logger;

    v: boolean; // verbose mode

    constructor({
        client,
        prefix,
        commandsDir,
        verbose = false,
        admins = [],
        testServers = [],
        triggers = [],
        helpCommand,
        logging: loggerOptions,
    }: HandlerConstructor) {
        this.client = client;
        this.commandsDir = pathJoin(pathDirname(process.argv[1]), commandsDir);
        this.commands = new Discord.Collection();
        this.v = verbose;

        this.opts = {
            prefix,
            admins: new Set(admins),
            testServers: new Set(testServers),
            triggers: new Discord.Collection(),
            helpCommand,
        };
        //* setting up built-in modules
        // triggers
        triggers.forEach(item => this.opts.triggers.set(item[0], item[1]));
        // help command
        if (helpCommand) HelpInit(this);
        // logging
        if (loggerOptions)
            this.logger = new logging.Logger(client, loggerOptions);

        this.listening = false;

        if (this.v) console.log("Command handler launching in verbose mode");

        // load the commands
        this.loadCommands(this.commandsDir);
    }

    async loadCommands(dir: string, nuke: boolean = false) {
        if (nuke) this.commands.clear();

        if (this.v) console.log(`Loading commands from: ${dir}`);
        let i = 0;
        for await (const entry of readdirp(dir, {
            fileFilter: ["*.js", "*.ts"],
        })) {
            delete entry.dirent; // dont need

            if (this.v) console.log(`Loading command: ${entry.basename}`);

            // import the actual file
            const command: Command = (await import(entry.fullPath)).command;

            if (!command.opts.category)
                command.opts.category =
                    entry.path.split(/\\|\//g).shift() || "No category";

            // error checking
            if (command === undefined)
                throw new Error(
                    `Couldn't import command from ${entry.path}. Make sure you are exporting a command variable that is a new Command`
                );
            if (this.getCommand(command.opts.names) !== undefined)
                throw new Error(
                    `Command name ${command.opts.names[0]} is being used twice!`
                );
            if (command.opts.adminOnly && this.opts.admins.size == 0)
                throw new Error(
                    `Command ${entry.path} is set to admin only, but no admins were defined.`
                );

            // add the command to the collection
            this.commands.set(command.opts.names[0], command);

            i++;
        }

        // if (this.v)
        console.log(`Finished loading ${i} commands.`);

        if (this.v)
            console.log(
                "Commands:",
                this.commands.map(item => item.opts.names[0])
            );

        // start listening to messages
        this.listen();
    }

    private listen() {
        // listen only once
        if (this.listening) return;
        this.listening = true;

        this.client.on("message", async message => {
            //* reaction triggers
            for (const item of this.opts.triggers.keyArray()) {
                if (message.content.toLowerCase().includes(item)) {
                    const emoji = this.opts.triggers.get(
                        item
                    ) as Discord.EmojiIdentifierResolvable;
                    reaction.React(message, emoji);
                }
            }

            //* prep to execute actual command
            if (
                !message.content.startsWith(this.opts.prefix) ||
                message.author.id == this.client.user?.id
            )
                return;

            const args = message.content
                .slice(this.opts.prefix.length)
                .trim()
                .split(/\s+/);

            // removes first item of args and that is the command name
            const commandName = args.shift()!.toLowerCase();
            const command = this.getCommand(commandName);
            // also sets "text" wich is all the args as a string
            const text = args.join(" ");

            /* i dont like annoying discord error messages whenever someone
            says something that starts with the prefix,
            but isnt actually a command and the bot says some bs */
            if (!command) return;

            if (
                command.opts.adminOnly &&
                !this.opts.admins.has(message.author.id)
            )
                return message.channel.send("You can't run this command!");

            if (
                command.opts.test &&
                !this.opts.testServers.has(message.guild!.id)
            )
                return console.log(
                    `${message.author.tag} tried to use test command: ${command.opts.names[0]}`
                );

            //* running the actual command
            await command.run({
                client: this.client,
                message,
                args,
                argv: yargs(args).argv,
                prefix: this.opts.prefix,
                handler: this,
                text,
                logger: this.logger,
            });
            if (command.opts.react) reaction.React(message, command.opts.react);

            //* log the command
            if (this.logger) this.logger.log(message);
        });
    }

    // find a command from any of its names
    getCommand(name: string | string[]): Command | undefined {
        if (typeof name === "string")
            return (
                this.commands.get(name) ||
                this.commands.find(c => c.opts.names.includes(name))
            );

        let found: Command | undefined = undefined;
        name.forEach(item => {
            const res = this.getCommand(item);
            if (res !== undefined) found = res;
        });
        return found;
    }
}

export type Commands = Discord.Collection<string, Command>;
export interface HandlerOpions {
    prefix: string;
    admins: Set<Discord.Snowflake>;
    testServers: Set<Discord.Snowflake>;
    triggers: Discord.Collection<string, Discord.EmojiIdentifierResolvable>;
    helpCommand?: HelpSettings;
}
export interface HandlerConstructor {
    readonly client: Discord.Client;
    prefix: string;
    commandsDir: string;
    verbose?: boolean;
    admins?: Array<Discord.Snowflake>;
    testServers?: Array<Discord.Snowflake>;
    triggers?: Array<Array<string>>;
    helpCommand?: HelpSettings;
    logging?: logging.LoggerOptions;
}
