import {
    ApplicationCommandData,
    Client,
    Collection,
    ColorResolvable,
    EmojiIdentifierResolvable,
    MessageEmbed,
    Snowflake,
} from "discord.js";
import EventEmitter from "events";
import mongoose from "mongoose";
import ms from "ms";
import { dirname as pathDirname, join as pathJoin } from "path";
import readdirp from "readdirp";
import Command from "./Command";
import { HelpSettings, init as HelpInit } from "./HelpCommand";
import { Logger, LoggerOptions } from "./Logging";
import * as models from "./Models";
import Trigger from "./Trigger";
import { cleanDB, slashCommandsChanged } from "./Utils";

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
    readonly client: Client<boolean>;
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
        testMode = false,
    }: HandlerConstructor) {
        super();

        if (client.readyAt === null)
            throw new Error(
                "The client must be ready when you create the handler."
            );

        this.client = client;
        this.commandsDir = pathJoin(pathDirname(process.argv[1]), commandsDir);
        this.commands = new Collection();
        this.v = verbose;

        this.opts = {
            prefix,
            admins: new Set(admins),
            testServers: new Set(testServers),
            triggers: new Collection(),
            helpCommand,
            blacklist: blacklist || [],
            pauseCommand,
            ignoreBots,
            testMode,
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

        this.v && console.log("Command handler launching in verbose mode");
        this.v && testMode && console.log("test mode: on");

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
     * **This will be called internally, you dont have to run this yourself**
     * Recursively reads a directory and loads all .js and .ts files
     * (if these files don't export a command they will just be ignored)
     * @param {string} dir - The directory to use
     */
    public async loadCommands(dir: string) {
        const globalSlash: ApplicationCommandData[] = [];
        const testSlash: ApplicationCommandData[] = [];

        this.v && console.log(`Loading commands from: ${dir}`);
        for await (const entry of readdirp(dir, {
            fileFilter: ["*.js", "*.ts"],
        })) {
            this.v && console.log(`Loading command: ${entry.basename}`);

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
                throw this.Error(
                    `Couldn't import command from ${entry.path}. Make sure you are exporting a command variable that is a new Command`
                );
            if (this.getCommand(command.opts.names) !== undefined)
                throw this.Error(
                    `Command name ${command.opts.names[0]} is being used twice!`
                );
            if (command.opts.adminOnly && this.opts.admins.size === 0)
                throw this.Error(
                    `Command ${entry.path} is set to admin only, but no admins were defined.`
                );
            if (command.opts.test && this.opts.testServers.size === 0)
                throw this.Error(
                    `Command ${entry.path} is set to test servers only but no test servers were defined.`
                );

            //* adding to commands
            this.commands.set(command.opts.names[0], command);

            //* registering the slash command
            if (!command.opts.noSlash) {
                if (!command.opts.description)
                    throw this.Error(
                        `${entry.path}: a description is required for slash commands! (and still recommended otherwise)`
                    );

                if (this.opts.testMode || command.opts.test) {
                    // only register in the test servers
                    testSlash.push({
                        name: command.opts.names[0].toLowerCase(),
                        description: command.opts.description,
                        options: command.opts.options ?? [],
                    });
                } else {
                    // register globally
                    globalSlash.push({
                        name: command.opts.names[0].toLowerCase(),
                        description: command.opts.description,
                        options: command.opts.options ?? [],
                    });
                }
            }
        }

        this.v && console.log("Registering slash commands...");

        // check if the registered commands are the same
        if (testSlash.length) {
            for (const GID of this.opts.testServers) {
                const guild = await this.client.guilds.fetch(GID);
                const c = await guild.commands.fetch();
                if (slashCommandsChanged(c, testSlash))
                    await guild.commands.set(testSlash);
                else
                    this.v &&
                        console.log(
                            `skipping test slash commands in guild ${guild.name}`
                        );
            }
        } else this.v && console.log("no test slash commands to register");

        if (globalSlash.length) {
            const c = await this.client.application?.commands.fetch()!;
            if (slashCommandsChanged(c, globalSlash))
                await this.client.application?.commands.set(globalSlash);
            else this.v && console.log("skipping global slash commands");
        } else this.v && console.log("no global slash commands to register");

        console.log(`Loaded ${this.commands.size} commands.`);

        this.v &&
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

        this.client.on("interactionCreate", async interaction => {
            if (!interaction.isCommand()) return;

            //* saving guild to db
            if (
                this.db &&
                !(await models.guild.findById(interaction.guild!.id))
            ) {
                const g = new models.guild({
                    _id: interaction.guild!.id,
                    cooldowns: [],
                    globalCooldowns: [],
                });
                await g.save();
            }

            const command = this.getCommand(interaction.commandName);
            if (!command || command.opts.noSlash) return;

            const trigger = new Trigger(this, command, interaction);

            if (await this.validateCommand(trigger))
                await this.executeCommand(trigger);
        });

        this.client.on("messageCreate", async message => {
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
            for (const item of [...this.opts.triggers.keys()]) {
                if (message.content.toLowerCase().includes(item)) {
                    const emoji = this.opts.triggers.get(
                        item
                    ) as EmojiIdentifierResolvable;
                    message.react(emoji);
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
            if (!command || command.opts.noClassic) return;

            const trigger = new Trigger(this, command, message);

            if (await this.validateCommand(trigger))
                await this.executeCommand(trigger);
        });
    }

    /**
     * Validate whether a user can execute a command in the provided context
     */
    public async validateCommand(trigger: Trigger) {
        const { command } = trigger;

        //* Classic only
        if (trigger.isClassic()) {
            const args = trigger.source.content
                .slice(this.opts.prefix.length)
                .trim()
                .split(/\s+/);
            const commandName = args.shift()!.toLowerCase();

            // too many args
            if (
                command.opts.maxArgs &&
                args.length > command.opts.maxArgs &&
                command.opts.maxArgs > 0
            ) {
                trigger.channel.send(
                    this.opts.errMsg?.tooManyArgs ||
                        `Too many args. For more info, see: ${this.opts.prefix}help ${commandName}`
                );
                return;
            }
            // not enough args
            if (command.opts.minArgs && args.length < command.opts.minArgs) {
                trigger.channel.send(
                    this.opts.errMsg?.tooFewArgs ||
                        `Not enough args. For more info, see: ${this.opts.prefix}help ${commandName}`
                );
                return;
            }
        }

        // command is test servers only
        if (
            command.opts.test &&
            !this.opts.testServers.has(trigger.guild!.id)
        ) {
            console.log(
                `${trigger.author.tag} tried to use test command: ${command.opts.names[0]}`
            );
            return;
        }
        // command is admins only
        if (
            command.opts.adminOnly &&
            !this.opts.admins.has(trigger.author.id)
        ) {
            trigger.channel.send(
                this.opts.errMsg?.noAdmin || "You can't run this command!"
            );
            return;
        }
        // command not allowed in dms
        if (trigger.channel.type === "DM" && command.opts.noDM) {
            trigger.channel.send(
                this.opts.errMsg?.noDM ||
                    "You can't use this command in the dms"
            );
            return;
        }
        // user or guild is on blacklist
        if (
            this.opts.blacklist.includes(trigger.author.id) ||
            command.opts.blacklist?.includes(trigger.author.id) ||
            this.opts.blacklist.includes(trigger.guild!?.id) ||
            command.opts.blacklist?.includes(trigger.guild!?.id)
        ) {
            trigger.channel.send(
                this.opts.errMsg?.blacklist ||
                    "You've been blacklisted from using this command"
            );
            return;
        }

        //* command is on cooldown
        if (
            trigger.channel.type != "DM" &&
            ((command.opts.cooldown as number) > 0 ||
                (command.opts.globalCooldown as number) > 0)
        ) {
            // const guild = this.cache.get(message.guild!.id);
            const guild: models.guild | null = (await models.guild.findById(
                trigger.guild!.id
            )) as models.guild;

            if (guild) {
                const CD = guild?.cooldowns.find(
                    cd =>
                        cd.user == trigger.author.id &&
                        cd.command == command.opts.names[0]
                );
                if (CD && CD!.expires > Date.now()) {
                    const t = ms(CD.expires - Date.now(), { long: true });

                    trigger.channel.send(
                        this.opts.errMsg?.cooldown ||
                            `This command is on cooldown for another ${t}.`
                    );
                    return;
                }

                const globalCD = guild?.globalCooldowns.find(
                    cd => cd.command == command.opts.names[0]
                );
                if (globalCD && globalCD!.expires > Date.now()) {
                    const t = ms(globalCD.expires - Date.now(), { long: true });

                    trigger.channel.send(
                        this.opts.errMsg?.globalCooldown ||
                            `This command is on cooldown for the entire server for another ${t}.`
                    );
                    return;
                }
            }
        }

        return true;
    }

    /**
     * Execute a command.
     * (this is the function used internally for launching the commands)
     * @param {Trigger} trigger - The trigger that lauhched the command
     * @returns true if successful, false if command falied
     */
    public async executeCommand(trigger: Trigger) {
        const { command } = trigger;
        // not a command
        if (!command) return false;

        const args = trigger.content
            .slice(this.opts.prefix.length)
            .trim()
            .split(/\s+/);
        // removes first item of args and that is the command name
        const commandName = args.shift()!.toLowerCase();
        // text is just all the args without the command name
        const text = trigger.content
            .substring(this.opts.prefix.length + commandName.length)
            .trim();
        const { argv } = trigger;
        const { deferred, ephemeral } = command.opts;

        // defer interaction
        if (trigger.isSlash() && deferred)
            await trigger.source.deferReply({ ephemeral });

        //* running the actual command
        const res = await command.run({
            client: this.client,
            trigger: trigger as any,
            args,
            argv,
            prefix: this.opts.prefix,
            handler: this,
            text,
            logger: this.logger,
        });

        if (trigger.isClassic() && command.opts.react && res)
            trigger.source.react(command.opts.react);

        //* log the command
        if (this.logger) this.logger.log(trigger);

        //* apply the cooldown (only on a successful command)
        if (res && (command.opts.cooldown || command.opts.globalCooldown)) {
            const guild: models.guild | null = (await models.guild.findById(
                trigger.guild!.id
            )) as models.guild;

            if (command.opts.cooldown) {
                // adding the cooldown
                guild?.cooldowns.push({
                    user: trigger.author.id,
                    command: command.opts.names[0],
                    expires: Date.now() + (command.opts.cooldown as number),
                });
                // removing the cooldown after it expired
                setTimeout(async () => {
                    const g: models.guild | null = (await models.guild.findById(
                        trigger.guild!.id
                    )) as models.guild;

                    const i = g?.cooldowns.findIndex(
                        cd =>
                            cd.user == trigger.author.id &&
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
                setTimeout(async () => {
                    const g: models.guild | null = (await models.guild.findById(
                        trigger.guild!.id
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

        return res ?? false;
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
                (err as Error).message
            );
            this.emit("dbConnectFailed", err);
        }
    }

    private Error(msg?: string): HandlerError {
        return new Error(msg);
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
        color?: ColorResolvable,
        thumbnail?: string
    ) {
        const emb = new MessageEmbed({
            title,
            description: desc,
        })
            .setAuthor(
                this.client.user!.username,
                this.client.user?.displayAvatarURL({ dynamic: true })
            )
            .setColor(color || "BLURPLE");
        if (thumbnail) emb.setThumbnail(thumbnail);

        return emb;
    }
}
export default Handler;

export type Commands = Collection<string, Command>;
export type HandlerOpions = {
    prefix: string;
    admins: Set<Snowflake>;
    testServers: Set<Snowflake>;
    triggers: Collection<string, EmojiIdentifierResolvable>;
    helpCommand?: HelpSettings;
    blacklist: Array<Snowflake>;
    pauseCommand?: string;
    ignoreBots?: boolean;
    testMode?: boolean;
    forceRegister?: boolean;
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
    readonly client: Client;
    prefix: string;
    commandsDir: string;
    verbose?: boolean;
    admins?: Array<Snowflake>;
    testServers?: Array<Snowflake>;
    triggers?: Array<Array<string>>;
    helpCommand?: HelpSettings;
    logging?: LoggerOptions;
    mongodb?: string;
    blacklist?: Array<Snowflake>;
    pauseCommand?: string;
    ignoreBots?: boolean;
    testMode?: boolean;
    forceRegister?: boolean;
};
export type HandlerEvents = {
    ready: () => void;
    dbConnected: () => void;
    dbConnectFailed: (err: unknown) => void;
    dbSynced: () => void;
};
export interface HandlerError extends Error {}
