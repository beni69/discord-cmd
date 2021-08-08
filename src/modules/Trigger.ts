import {
    Client,
    Collection,
    CommandInteraction,
    CommandInteractionOption,
    CommandInteractionOptionResolver,
    DMChannel,
    Guild,
    GuildMember,
    InteractionReplyOptions,
    Message,
    MessagePayload,
    NewsChannel,
    ReplyMessageOptions,
    Snowflake,
    TextChannel,
    User,
} from "discord.js";
import yargs from "yargs-parser";
import Command from "./Command";
import Handler from "./Handler";
import { resolveMention } from "./Utils";

export class Trigger {
    readonly handler: Handler;
    readonly command: Command;
    readonly source: Message | CommandInteraction;
    protected opts: TriggerOptions;
    private response?: Message;
    id: Snowflake;
    client: Client;
    guild: Guild | null;
    channel: TextChannel | DMChannel | NewsChannel;
    member: GuildMember | null;
    createdAt: Date;
    author: User;
    content: string;
    argv: CommandInteractionOptionResolver;
    createdTimestamp: number;
    error?: Error;

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
        this.channel = source.channel as any;
        this.member = source.member as GuildMember | null;
        this.createdAt = source.createdAt;
        this.createdTimestamp = source.createdTimestamp;

        if ("author" in source) {
            this.author = source.author;
            this.content = source.content;
            // this.argv = this.args2Coll(
            //     this.content.substring(
            //         this.handler.getOpts.prefix.length +
            //             this.content
            //                 .slice(this.handler.getOpts.prefix.length)
            //                 .trim()
            //                 .split(/\s+/)
            //                 .shift()?.length!
            //     )
            // );
            this.argv = this.args2Opt(this.args);
        } else {
            this.author = source.user;
            this.content = `/${source.commandName} ${
                source.options && source.options.data.map(o => o.value)
            }`.trim();
            // this.argv = source.options.mapValues(o => o.value);
            this.argv = source.options;
        }
    }

    public get args(): any[] {
        if (this.isClassic())
            return this.content
                .slice(this.handler.getOpts.prefix.length)
                .trim()
                .split(/\s+/)
                .slice(1);
        else
            return (this.source as CommandInteraction).options.data.map(
                o => o.value
            );
    }

    public isClassic = (): this is ClassicTrigger => "author" in this.source;
    public isSlash = (): this is SlashTrigger => !this.isClassic();

    public reply = async (
        msg:
            | string
            | MessagePayload
            | (ReplyMessageOptions & InteractionReplyOptions)
    ) => {
        if (this.isClassic()) {
            this.response = await this.source.reply(msg);
            return this.response;
        } else if (this.isSlash())
            return await this.source.reply(
                // @ts-ignore
                typeof msg === "string"
                    ? { ephemeral: this.opts.ephemeral, content: msg }
                    : { ephemeral: this.opts.ephemeral, ...msg }
            );
    };

    public fetchReply = () => {
        if (this.isClassic()) return this.response;
        else if (this.isSlash())
            return this.source.fetchReply() as Promise<Message>;
    };

    public edit = (msg: string | MessagePayload) => {
        if (this.isClassic()) {
            if (!this.response)
                throw new Error("you haven't responded to this message yet!");
            return this.response.edit(msg);
        } else if (this.isSlash()) {
            return this.source.editReply(msg);
        }
    };

    public followUp = (
        msg:
            | string
            | MessagePayload
            | (ReplyMessageOptions & InteractionReplyOptions)
    ) => {
        if (this.isClassic()) {
            return this.source.reply(msg);
        } else if (this.isSlash()) {
            return this.source.followUp(msg);
        }
    };

    private args2Opt = (args: string[]): CommandInteractionOptionResolver => {
        const argv = yargs(args);

        const opts: CommandInteractionOption[] = [];

        this.command.opts.options?.forEach((o, i) => {
            const res = resolveMention(
                this.guild || ({ client: this.client } as Guild),
                args[i]
            );

            if (res.type !== o.type) {
                this.error = new Error("invalid argument type");
                return;
            }

            opts.push({ ...res, name: o.name });
        });

        return new CommandInteractionOptionResolver(this.client, opts);
    };

    private args2Coll = (args: string | string[]): Collection<string, any> => {
        const collection = new Collection<TriggerArgKeys, any>();

        const add = (key: string, value: any) => {
            // make snowflake resolvable
            if (
                (["USER", "CHANNEL"] as any[]).includes(
                    this.command.opts.options?.find(op => op.name === key)?.type
                )
            ) {
                value = (value + "").replace(/\!|\@|\#|\<|\>/gi, "");
            }

            collection.set(key, value);
        };

        const argv = yargs(args);

        const aliases = this.command.opts.argvAliases;

        if (aliases) {
            const keys = Object.keys(aliases);

            keys.forEach(key => {
                aliases[key].forEach(
                    alias => argv[alias] && add(key, argv[alias])
                );
                argv[key] && add(key, argv[key]);
            });
        }

        if (this.command.opts.options)
            this.command.opts.options.forEach(o => {
                argv[o.name] && add(o.name, argv[o.name]);
            });

        collection.set("_yargs", argv);

        return collection;
    };
}
export interface ClassicTrigger extends Trigger {
    source: Message;

    args: string[];

    fetchReply: () => Promise<Message>;
    reply: (
        msg: string | MessagePayload | ReplyMessageOptions
    ) => Promise<Message>;
    edit: (
        msg: string | MessagePayload | ReplyMessageOptions
    ) => Promise<Message>;
}
export interface SlashTrigger extends Trigger {
    source: CommandInteraction;

    fetchReply: () => Promise<Message>;
    reply: (
        msg: string | MessagePayload | InteractionReplyOptions
    ) => Promise<undefined>;
    edit: any;
}
export type TriggerOptions = { ephemeral: boolean; deferred: boolean };
export type TriggerArgKeys = "_yargs" | string;
export default Trigger;
