import Discord from "discord.js";
import Trigger from "./Trigger";

export class Logger {
    readonly client: Discord.Client;
    channels: Array<Discord.TextChannel | Discord.DMChannel>;
    format: LoggerFormat;

    constructor(client: Discord.Client, { channel, format }: LoggerOptions) {
        this.client = client;

        if (typeof channel === "string")
            this.channels = [
                client.channels.cache.get(channel) as Discord.TextChannel,
            ];
        else
            this.channels = channel.map(
                ch => client.channels.cache.get(ch) as Discord.TextChannel
            );

        this.format = format;
    }

    log(trigger: Trigger, format: LoggerFormat = this.format) {
        const str = this.getFormat(trigger, format);

        this.channels.forEach(ch => ch.send(str));
    }
    send(str: string) {
        this.channels.forEach(ch => ch.send(str));
    }

    getFormat(trigger: Trigger, format: LoggerFormat | string) {
        format = typeof format === "object" ? format.join("") : format;
        return format
            .replace("$authorName$", trigger.author.tag)
            .replace("$authorTag$", trigger.author.toString())
            .replace("$content$", trigger.content)
            .replace(
                "$channelName$",
                trigger.channel.type === "dm"
                    ? trigger.author.tag
                    : trigger.channel.name
            )
            .replace("$channelTag$", trigger.channel.toString())
            .replace(
                "$serverName$",
                trigger.guild?.name || trigger.author.toString()
            )
            .replace("$timestamp$", trigger.createdAt.toLocaleString());
    }
}
export default Logger;

export interface LoggerOptions {
    channel: Discord.Snowflake | Array<Discord.Snowflake>;
    format: LoggerFormat;
}

export type LoggerFormat = `$${LoggerFormatTypes}$`[] | string | string[];
export type LoggerFormatTypes =
    | "authorName"
    | "authorTag"
    | "content"
    | "channelName"
    | "channelTag"
    | "serverName"
    | "timestamp";
