import Discord from "discord.js";
import EventEmitter from "events";
import mongoose from "mongoose";
import { dirname as pathDirname, join as pathJoin } from "path";
import readdirp from "readdirp";
import yargs from "yargs";
import Command from "./Command";
import { HelpSettings, init as HelpInit } from "./HelpCommand";
import * as logging from "./Logging";
import * as models from "./Models";
import * as reaction from "./Reaction";

export declare interface Handler {
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
    private paused: boolean = false;
    private logger?: logging.Logger;
    private cache: HandlerCache;

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
    }: HandlerConstructor) {
        super();

        this.client = client;
        this.commandsDir = pathJoin(pathDirname(process.argv[1]), commandsDir);
        this.commands = new Discord.Collection();
        this.cache = new Discord.Collection();
        this.v = verbose;

        this.opts = {
            prefix,
            admins: new Set(admins),
            testServers: new Set(testServers),
            triggers: new Discord.Collection(),
            helpCommand,
            blacklist: blacklist || [],
            pauseCommand,
        };
        //* setting up built-in modules
        // triggers
        triggers.forEach(item => this.opts.triggers.set(item[0], item[1]));
        // help command
        if (helpCommand) HelpInit(this);
        // logging
        if (loggerOptions)
            this.logger = new logging.Logger(client, loggerOptions);

        // this.listening = false;
        // this.paused = false;

        if (this.v) console.log("Command handler launching in verbose mode");

        // load the commands
        this.loadCommands(this.commandsDir);

        // connect to db and set up sync
        if (mongodb) this.dbConnect(mongodb);
        client.setInterval(() => this.sync(), 60 * 1000 * 5);
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

    async loadCommands(dir: string, reload: boolean = false) {
        if (reload) this.commands.clear();

        if (this.v) console.log(`Loading commands from: ${dir}`);
        for await (const entry of readdirp(dir, {
            fileFilter: ["*.js", "*.ts"],
        })) {
            delete entry.dirent; // dont need

            if (this.v) console.log(`Loading command: ${entry.basename}`);

            // import the actual file
            const command: Command = (await import(entry.fullPath)).command;
            if (!command) return;

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
    }

    private listen() {
        // listen only once
        if (this.listening) return;
        this.listening = true;

        this.client.on("message", async message => {
            if (
                this.paused &&
                message.content != this.opts.prefix + this.opts.pauseCommand
            )
                return;

            //* add server to cache
            if (
                message.channel.type != "dm" &&
                !this.cache.has(message.guild!.id)
            ) {
                const m = new models.guild({
                    _id: message.guild!.id,
                    cooldowns: [],
                    globalCooldowns: [],
                });
                this.cache.set(
                    message.guild!.id,
                    // @ts-ignore
                    m
                );
                m.save();
            }
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

            // not a command
            if (!command) return;
            // command is test servers only
            if (
                command.opts.test &&
                !this.opts.testServers.has(message.guild!.id)
            )
                return console.log(
                    `${message.author.tag} tried to use test command: ${command.opts.names[0]}`
                );
            // command is admins only
            if (
                command.opts.adminOnly &&
                !this.opts.admins.has(message.author.id)
            )
                return message.channel.send(
                    this.opts.errMsg?.noAdmin || "You can't run this command!"
                );
            // command not allowed in dms
            if (message.channel.type === "dm" && command.opts.noDM)
                return message.channel.send(
                    this.opts.errMsg?.noDM ||
                        "You can't use this command in the dms"
                );
            // user is on blacklist
            if (
                this.opts.blacklist.includes(message.author.id) ||
                command.opts.backlist?.includes(message.author.id)
            )
                return message.channel.send(
                    this.opts.errMsg?.blacklist ||
                        "You've been blacklisted from using this command"
                );
            // too many args
            if (
                command.opts.maxArgs &&
                args.length > command.opts.maxArgs &&
                command.opts.maxArgs > 0
            )
                return message.channel.send(
                    this.opts.errMsg?.tooManyArgs ||
                        `Too many args. For more info, see: ${this.opts.prefix}help ${commandName}`
                );
            // not enough args
            if (command.opts.minArgs && args.length < command.opts.minArgs)
                return message.channel.send(
                    this.opts.errMsg?.tooFewArgs ||
                        `Not enough args. For more info, see: ${this.opts.prefix}help ${commandName}`
                );
            // cooldowns
            if (
                message.channel.type != "dm" &&
                (command.opts.cooldown as number) > 0
            ) {
                const guild = this.cache.get(message.guild!.id);
                const CD = guild?.cooldowns.find(
                    cd =>
                        cd.user == message.author.id &&
                        cd.command == command.opts.names[0]
                );
                if (CD && CD!.expires > Date.now())
                    return message.channel.send(
                        this.opts.errMsg?.cooldown ||
                            `This command is on cooldown for another ${1} seconds.`
                    );

                const globalCD = guild?.globalCooldowns.find(
                    cd => cd.command == command.opts.names[0]
                );
                if (globalCD && globalCD!.expires > Date.now())
                    return message.channel.send(
                        this.opts.errMsg?.globalCooldown ||
                            `This command is on cooldown for the entire server for another ${1} seconds.`
                    );
            }

            //* running the actual command
            const res = await command.run({
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

            //* apply the cooldown (not if command falied)
            if (res !== false) {
                const guild = this.cache.get(message.guild!.id);
                if (command.opts.cooldown) {
                    guild?.cooldowns.push({
                        user: message.author.id,
                        command: command.opts.names[0],
                        expires: Date.now() + (command.opts.cooldown as number),
                    });
                    this.client.setTimeout(() => {
                        const g = this.cache.get(message.guild!.id)!;
                        const i = g?.cooldowns.findIndex(
                            cd =>
                                cd.user == message.author.id &&
                                cd.command == command.opts.names[0]
                        );
                        if (i === -1) return;
                        g?.cooldowns.splice(i, 1);
                        this.cache.set(message.guild!.id, g);
                    }, command.opts.cooldown as number);
                }
                if (command.opts.globalCooldown) {
                    guild?.globalCooldowns.push({
                        command: command.opts.names[0],
                        expires:
                            Date.now() +
                            (command.opts.globalCooldown as number),
                    });
                    this.client.setTimeout(() => {
                        const g = this.cache.get(message.guild!.id)!;
                        const i = g?.globalCooldowns.findIndex(
                            cd => cd.command == command.opts.names[0]
                        );
                        if (i === -1) return;
                        g?.globalCooldowns.splice(i, 1);
                        this.cache.set(message.guild!.id, g);
                    }, command.opts.globalCooldown as number);
                }

                this.cache.set(message.guild!.id, guild!);
                this.sync();
            }
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

    private async dbConnect(uri: string) {
        try {
            await mongoose.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                useFindAndModify: false,
                useCreateIndex: true,
            });

            console.log("Handler connected to DB");
            this.emit("dbConnected");
            this.sync();
        } catch (err) {
            console.error(
                "Handler failed to connect to MongoDB: ",
                err.message
            );
            this.emit("dbConnectFailed", err);
        }
    }
    async sync() {
        if (!this.cache.size)
            await models.guild.find((err, found) => {
                if (err) console.error(err);
                // cache all the data
                found.forEach(x =>
                    this.cache.set(x._id, (x as unknown) as models.guild)
                );

                // delete all the expired cooldowns
                this.cache.forEach(g => {
                    // per-user cooldowns
                    let toDelete: number[] = [];
                    g.cooldowns.forEach((cd, i) => {
                        if (cd.expires < Date.now()) toDelete.push(i);
                    });
                    toDelete.forEach(n => g.cooldowns.splice(n, 1));

                    // global cooldowns
                    toDelete = [];
                    g.globalCooldowns.forEach((cd, i) => {
                        if (cd.expires < Date.now()) toDelete.push(i);
                    });
                    toDelete.forEach(n => g.globalCooldowns.splice(n, 1));

                    this.cache.set(g._id, g);
                });
            });

        // upload the new data
        this.cache.forEach(async g => {
            // @ts-ignore
            await g.updateOne();
            if (this.v)
                console.log(
                    `Saved guild ${this.client.guilds.cache.get(g._id)?.name}`
                );
        });
        this.emit("dbSynced");
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
    logging?: logging.LoggerOptions;
    mongodb?: string;
    blacklist?: Array<Discord.Snowflake>;
    pauseCommand?: string;
};
export type HandlerEvents = {
    dbConnected: () => void;
    dbConnectFailed: (err: unknown) => void;
    dbSynced: () => void;
};
export type HandlerCache = Discord.Collection<string, models.guild>;
