import Discord from "discord.js";
import EventEmitter from "events";
import mongoose from "mongoose";
import { dirname as pathDirname, join as pathJoin } from "path";
import readdirp from "readdirp";
import yargs from "yargs";
import Command from "./Command";
import { HelpSettings, init as HelpInit } from "./HelpCommand";
import { Logger, LoggerOptions } from "./Logging";
import * as models from "./Models";
import { React } from "./Reaction";
import { cleanDB, toTime } from "./Utils";

export interface Handler {
    on<U extends keyof HandlerEvents>(
        event: U,
        listener: HandlerEvents[U]
    ): this;
    emit<U extends keyof HandlerEvents>(
        event: U,
        ...args: Parameters<HandlerEvents[U]>
    ): boolean;
}

export class Handler extends EventEmitter {
    readonly client: Discord.Client;
    public commands: Commands;
    private commandsDir: string;
    private opts: HandlerOpions;
    private listening: boolean = false;
    readonly v: boolean; // verbose mode
    private db: boolean; // whether we have a db connection
    private paused: boolean = false;
    private logger?: Logger;

    /**
     * Create a new command handler
     * @param {HandlerConstructor} opts - Put all options in this object. Only the client, prefix and commands directory are requred, everthing else is optional.
     */
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
        mongodb,
        blacklist,
        pauseCommand,
        ignoreBots = false,
    }: HandlerConstructor) {
        super();

        if (client.readyAt === null)
            throw new Error(
                "The client must be ready when you create the handler."
            );

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
            blacklist: blacklist || [],
            pauseCommand,
            ignoreBots,
        };
        //* setting up built-in modules
        // triggers
        triggers.forEach(item => this.opts.triggers.set(item[0], item[1]));
        // help command
        if (helpCommand) HelpInit(this);
        // logging
        if (loggerOptions) this.logger = new Logger(client, loggerOptions);

        this.listening = false;
        this.paused = false;
        this.db = false;

        if (this.v) console.log("Command handler launching in verbose mode");

        // load the commands
        this.loadCommands(this.commandsDir);

        // connect to db and set up sync
        if (mongodb) this.dbConnect(mongodb);
    }

    public get isPaused(): boolean {
        return this.paused;
    }
    public set pause(v: boolean) {
        this.paused = v;
    }
    public get getOpts(): HandlerOpions {
        return this.opts;
    }
    public get getCommands(): Commands {
        return this.commands;
    }
    public get getLogger(): Logger | undefined {
        return this.logger;
    }

    /**
     * Recursively reads a directory and loads all .js and .ts files
     * (if these files don't export a command they will just be ignored)
     * @param {string} dir - The directory to use
     * @param {boolean} reload - Whether to clear the command list before reading (useful to reload the commands)
     */
    public async loadCommands(dir: string, reload: boolean = false) {
        if (reload) this.commands.clear();

        if (this.v) console.log(`Loading commands from: ${dir}`);
        for await (const entry of readdirp(dir, {
            fileFilter: ["*.js", "*.ts"],
        })) {
            if (this.v) console.log(`Loading command: ${entry.basename}`);

            // import the actual file
            const command: Command = (await import(entry.fullPath)).command;
            if (!command) continue;

            if (!command.opts.category) {
                const r = new RegExp(/\\|\//, "g");
                command.opts.category =
                    entry.path.split(r).length > 1
                        ? entry.path.split(r).shift()
                        : "No category";
            }

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
        }

        if (!reload || this.v)
            console.log(`Finished loading ${this.commands.size} commands.`);

        if (this.v)
            console.log(
                "Commands:",
                this.commands.map(item => item.opts.names[0])
            );

        // start listening to messages
        this.listen();
        this.emit("ready");
    }

    /**
     * Listen for messages
     */
    private listen() {
        // listen only once
        if (this.listening) return;
        this.listening = true;

        this.client.on("message", async message => {
            if (
                (this.paused &&
                    message.content !=
                        this.opts.prefix + this.opts.pauseCommand) ||
                message.author.id === this.client.user?.id
            )
                return;

            //* saving guild to db
            if (this.db && !(await models.guild.findById(message.guild!.id))) {
                const g = new models.guild({
                    _id: message.guild!.id,
                    cooldowns: [],
                    globalCooldowns: [],
                });
                await g.save();
            }

            //* reaction triggers
            for (const item of this.opts.triggers.keyArray()) {
                if (message.content.toLowerCase().includes(item)) {
                    const emoji = this.opts.triggers.get(
                        item
                    ) as Discord.EmojiIdentifierResolvable;
                    React(message, emoji);
                }
            }

            //* prep to execute actual command
            if (!message.content.startsWith(this.opts.prefix)) return;

            const args = message.content
                .slice(this.opts.prefix.length)
                .trim()
                .split(/\s+/);

            // removes first item of args and that is the command name
            const commandName = args.shift()!.toLowerCase();
            const command = this.getCommand(commandName);

            await this.executeCommand(message, command);
        });
    }

    /**
     * Execute a command.
     * (this is the function used internally for launching the commands)
     * @param {Discord.Message} message - The message that contains the command
     * @param {Command} command - The command to execute. (pro tip: combine with handler.getCommand)
     * @returns void
     */
    public async executeCommand(
        message: Discord.Message,
        command: Command | undefined
    ) {
        // not a command
        if (!command) return;

        const args = message.content
            .slice(this.opts.prefix.length)
            .trim()
            .split(/\s+/);

        // removes first item of args and that is the command name
        const commandName = args.shift()!.toLowerCase();

        // text is just all the args without the command name
        const text = message.content.replace(
            this.opts.prefix + commandName,
            ""
        );

        //* error checking
        // command is test servers only
        if (
            command.opts.test &&
            !this.opts.testServers.has(message.guild!.id)
        ) {
            console.log(
                `${message.author.tag} tried to use test command: ${command.opts.names[0]}`
            );
            return;
        }
        // command is admins only
        if (
            command.opts.adminOnly &&
            !this.opts.admins.has(message.author.id)
        ) {
            message.channel.send(
                this.opts.errMsg?.noAdmin || "You can't run this command!"
            );
            return;
        }
        // command not allowed in dms
        if (message.channel.type === "dm" && command.opts.noDM) {
            message.channel.send(
                this.opts.errMsg?.noDM ||
                    "You can't use this command in the dms"
            );
            return;
        }
        // user or guild is on blacklist
        if (
            this.opts.blacklist.includes(message.author.id) ||
            command.opts.blacklist?.includes(message.author.id) ||
            this.opts.blacklist.includes(message.guild!?.id) ||
            command.opts.blacklist?.includes(message.guild!?.id)
        ) {
            message.channel.send(
                this.opts.errMsg?.blacklist ||
                    "You've been blacklisted from using this command"
            );
            return;
        }
        // too many args
        if (
            command.opts.maxArgs &&
            args.length > command.opts.maxArgs &&
            command.opts.maxArgs > 0
        ) {
            message.channel.send(
                this.opts.errMsg?.tooManyArgs ||
                    `Too many args. For more info, see: ${this.opts.prefix}help ${commandName}`
            );
            return;
        }
        // not enough args
        if (command.opts.minArgs && args.length < command.opts.minArgs) {
            message.channel.send(
                this.opts.errMsg?.tooFewArgs ||
                    `Not enough args. For more info, see: ${this.opts.prefix}help ${commandName}`
            );
            return;
        }
        //* command is on cooldown
        if (
            message.channel.type != "dm" &&
            ((command.opts.cooldown as number) > 0 ||
                (command.opts.globalCooldown as number) > 0)
        ) {
            // const guild = this.cache.get(message.guild!.id);
            const guild: models.guild | null = (await models.guild.findById(
                message.guild!.id
            )) as models.guild;

            if (guild) {
                const CD = guild?.cooldowns.find(
                    cd =>
                        cd.user == message.author.id &&
                        cd.command == command.opts.names[0]
                );
                if (CD && CD!.expires > Date.now()) {
                    const t = toTime(CD.expires - Date.now(), true);

                    message.channel.send(
                        this.opts.errMsg?.cooldown ||
                            `This command is on cooldown for another ${t}.`
                    );
                    return;
                }

                const globalCD = guild?.globalCooldowns.find(
                    cd => cd.command == command.opts.names[0]
                );
                if (globalCD && globalCD!.expires > Date.now()) {
                    const t = toTime(globalCD.expires - Date.now(), true);

                    message.channel.send(
                        this.opts.errMsg?.globalCooldown ||
                            `This command is on cooldown for the entire server for another ${t}.`
                    );
                    return;
                }
            }
        }

        //* running the actual command
        // coming soon
        // const argv = arg(command.opts.argv || {}, { argv: args });
        const argv = yargs(args).argv;

        const res = await command.run({
            client: this.client,
            message,
            args,
            argv,
            prefix: this.opts.prefix,
            handler: this,
            text,
            logger: this.logger,
        });

        if (command.opts.react && res !== false)
            React(message, command.opts.react);

        //* log the command
        if (this.logger) this.logger.log(message);

        //* apply the cooldown (not if command falied)
        if (
            res !== false &&
            (command.opts.cooldown || command.opts.globalCooldown)
        ) {
            const guild: models.guild | null = (await models.guild.findById(
                message.guild!.id
            )) as models.guild;

            if (command.opts.cooldown) {
                // adding the cooldown
                guild?.cooldowns.push({
                    user: message.author.id,
                    command: command.opts.names[0],
                    expires: Date.now() + (command.opts.cooldown as number),
                });
                // removing the cooldown after it expired
                this.client.setTimeout(async () => {
                    const g: models.guild | null = (await models.guild.findById(
                        message.guild!.id
                    )) as models.guild;

                    const i = g?.cooldowns.findIndex(
                        cd =>
                            cd.user == message.author.id &&
                            cd.command == command.opts.names[0]
                    );
                    if (i === -1) return;
                    g?.cooldowns.splice(i, 1);

                    await g.updateOne({ cooldowns: g.cooldowns });
                }, command.opts.cooldown as number);
            }
            if (command.opts.globalCooldown) {
                guild?.globalCooldowns.push({
                    command: command.opts.names[0],
                    expires:
                        Date.now() + (command.opts.globalCooldown as number),
                });
                this.client.setTimeout(async () => {
                    const g: models.guild | null = (await models.guild.findById(
                        message.guild!.id
                    )) as models.guild;

                    const i = g?.globalCooldowns.findIndex(
                        cd => cd.command == command.opts.names[0]
                    );
                    if (i === -1) return;
                    g?.globalCooldowns.splice(i, 1);

                    await g.updateOne({
                        globalCooldowns: g.globalCooldowns,
                    });
                }, command.opts.globalCooldown as number);
            }

            await guild.updateOne({
                cooldowns: guild.cooldowns,
                globalCooldowns: guild.globalCooldowns,
            });
        }

        return res;
    }

    /**
     * Find a command from any of its aliases
     * (this is the function used internally for finding commands)
     * @param {string} name - Name or names of a command
     * @returns The command or undefined if no command was found
     */
    public getCommand(name: string | string[]): Command | undefined {
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

    /**
     * Connect to the database (for cooldowns)
     * @param {string} uri - MongoDB connection string
     */
    private async dbConnect(uri: string) {
        try {
            await mongoose.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                useFindAndModify: false,
                useCreateIndex: true,
            });

            console.log("Handler connected to DB");
            this.db = true;
            this.emit("dbConnected");
            await cleanDB();
        } catch (err) {
            console.error(
                "Handler failed to connect to MongoDB: ",
                err.message
            );
            this.emit("dbConnectFailed", err);
        }
    }

    /**
     * A utility function to create nice embeds.
     * @param title
     * @param desc
     * @param color
     * @param thumbnail
     */
    public makeEmbed(
        title: string,
        desc: string,
        color?: Discord.ColorResolvable,
        thumbnail?: string
    ) {
        const emb = new Discord.MessageEmbed({
            title,
            description: desc,
        })
            .setAuthor(
                this.client.user?.username,
                this.client.user?.displayAvatarURL({ dynamic: true })
            )
            .setColor(color || "BLURPLE");
        if (thumbnail) emb.setThumbnail(thumbnail);

        return emb;
    }
}
export default Handler;

export type Commands = Discord.Collection<string, Command>;
export type HandlerOpions = {
    prefix: string;
    admins: Set<Discord.Snowflake>;
    testServers: Set<Discord.Snowflake>;
    triggers: Discord.Collection<string, Discord.EmojiIdentifierResolvable>;
    helpCommand?: HelpSettings;
    blacklist: Array<Discord.Snowflake>;
    pauseCommand?: string;
    ignoreBots?: boolean;
    errMsg?: {
        tooFewArgs?: string;
        tooManyArgs?: string;
        noAdmin?: string;
        cooldown?: string;
        globalCooldown?: string;
        blacklist?: string;
        noDM?: string;
    };
};
export type HandlerConstructor = {
    readonly client: Discord.Client;
    prefix: string;
    commandsDir: string;
    verbose?: boolean;
    admins?: Array<Discord.Snowflake>;
    testServers?: Array<Discord.Snowflake>;
    triggers?: Array<Array<string>>;
    helpCommand?: HelpSettings;
    logging?: LoggerOptions;
    mongodb?: string;
    blacklist?: Array<Discord.Snowflake>;
    pauseCommand?: string;
    ignoreBots?: boolean;
};
export type HandlerEvents = {
    ready: () => void;
    dbConnected: () => void;
    dbConnectFailed: (err: unknown) => void;
    dbSynced: () => void;
};
export type HandlerCache = Discord.Collection<string, models.guild>;
