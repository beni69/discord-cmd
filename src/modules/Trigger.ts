import Discord from "discord.js";

export class Trigger {
    constructor(source: Discord.Message | Discord.CommandInteraction) {
        this.source = source;
        this.id = source.id;
        this.client = source.client;
        this.guild = source.guild;
        this.channel = source.channel;
        this.member = source.member as Discord.GuildMember | null;
        // this.reply = source.reply;
        this.createdAt = source.createdAt;

        if (source instanceof Discord.Message) {
            this.author = source.author;
            this.content = source.content;
        } else {
            this.author = source.user;
            this.content = `/${source.commandName} ${Array.from(
                source.options
            ).join(" ")}`;
        }
    }

    public isClassic = (): this is ClassicTrigger =>
        this.source instanceof Discord.Message;

    // public  reply =async (msg: Discord.APIMessage) => {
    //     if (this.isClassic()) {
    //         return this.source.reply(msg);
    //     } else {
    //         return this.source.reply(msg);
    //     }
    // };
    public reply = async (msg: Discord.APIMessage) => this.source.reply(msg);
}

export interface Trigger {
    source: Discord.Message | Discord.CommandInteraction;
    id: `${bigint}`;
    content: string;
    client: Discord.Client;
    guild: Discord.Guild | null;
    channel: Discord.TextChannel | Discord.DMChannel | Discord.NewsChannel;
    member: Discord.GuildMember | null;
    author: Discord.User;
    createdAt: Date;
    isClassic: () => this is ClassicTrigger;
    reply: (msg: Discord.APIMessage) => Promise<Discord.Message | void>;
}
export interface ClassicTrigger extends Trigger {
    source: Discord.Message;
}
export interface SlashTrigger extends Trigger {
    source: Discord.CommandInteraction;
}
export default Trigger;
