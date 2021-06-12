import {
    APIMessage,
    Client,
    Collection,
    CommandInteraction,
    DMChannel,
    Guild,
    GuildMember,
    InteractionReplyOptions,
    Message,
    NewsChannel,
    ReplyMessageOptions,
    ReplyOptions,
    TextChannel,
    User,
} from "discord.js";
import Command from "./Command";
import Handler from "./Handler";
import yargs from "yargs-parser";

export class Trigger {
    readonly handler: Handler;
    readonly command: Command;
    readonly source: Message | CommandInteraction;
    protected opts: TriggerOptions;
    id: `${bigint}`;
    client: Client;
    guild: Guild | null;
    channel: TextChannel | DMChannel | NewsChannel;
    member: GuildMember | null;
    createdAt: Date;
    author: User;
    content: string;
    argv: Collection<string, any>;

    constructor(
        handler: Handler,
        command: Command,
        source: Message | CommandInteraction
    ) {
        this.handler = handler;
        this.command = command;
        this.source = source;
        this.opts = {
            ephemeral: !!command.opts.ephemeral,
            deferred: !!command.opts.deferred,
        };
        this.id = source.id;
        this.client = source.client;
        this.guild = source.guild;
        this.channel = source.channel;
        this.member = source.member as GuildMember | null;
        this.createdAt = source.createdAt;

        if (source instanceof Message) {
            this.author = source.author;
            this.content = source.content;
            this.argv = this.args2Coll(
                this.content.substring(
                    this.handler.getOpts.prefix.length +
                        this.content
                            .slice(this.handler.getOpts.prefix.length)
                            .trim()
                            .split(/\s+/)
                            .shift()?.length!
                )
            );
        } else {
            this.author = source.user;
            this.content = `/${source.commandName} ${Array.from(source.options)
                .map(o => o[1].value)
                .join(" ")}`;
            this.argv = source.options.mapValues(o => o.value);
        }
    }

    public get args() {
        return this.content
            .slice(this.handler.getOpts.prefix.length)
            .trim()
            .split(/\s+/)
            .slice(1);
    }

    public isClassic = (): this is ClassicTrigger =>
        this.source instanceof Message;
    public isSlash = (): this is SlashTrigger =>
        this.source instanceof CommandInteraction;

    public reply = async (msg: string | APIMessage) => {
        return this.source.reply(msg);
    };

    private args2Coll = (args: string | string[]): Collection<string, any> => {
        const collection = new Collection<string, any>();

        const argv = yargs(args);
        console.log({ argv });

        const aliases = this.command.opts.argvAliases;

        if (aliases) {
            const keys = Object.keys(aliases);

            keys.forEach(key =>
                aliases[key].forEach(
                    alias => argv[alias] && collection.set(key, argv[alias])
                )
            );
        }

        if (this.command.opts.options)
            this.command.opts.options.forEach(o => {
                argv[o.name] && collection.set(o.name, argv[o.name]);
            });

        collection.set("_yargs", argv);

        console.log({ collection });

        return collection;
    };
}
export class ClassicTrigger extends Trigger {
    source!: Message;

    public reply = async (msg: string | APIMessage | ReplyOptions) =>
        this.source.reply(msg);
}
export class SlashTrigger extends Trigger {
    source!: CommandInteraction;

    public get args(): any[] {
        return Array.from(this.source.options).map(o => o[1].value);
    }

    public reply = async (msg: string | APIMessage | InteractionReplyOptions) =>
        // @ts-ignore
        this.source.reply({
            ephemeral: this.opts.ephemeral,
            ...(typeof msg === "string" ? { content: msg } : msg),
        });
}
export type TriggerOptions = { ephemeral: boolean; deferred: boolean };
export default Trigger;
