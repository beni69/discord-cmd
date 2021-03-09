import Discord from "discord.js";

export class Logger {
    readonly client: Discord.Client;
    channels: Array<Discord.TextChannel | Discord.DMChannel>;
    format: LoggerFormatTypes | string;

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

        if (typeof format === "object") this.format = format.join("");
        else this.format = format;
    }

    log(message?: Discord.Message, format = this.format) {
        const str = message ? this.getFormat(message, format) : format;

        this.channels.forEach(ch => ch.send(str));
    }

    getFormat(message: Discord.Message, format: LoggerFormatTypes | string) {
        return format
            .replace("$authorName$", message.author.tag)
            .replace("$authorTag$", message.author.toString())
            .replace("$content$", message.content)
            .replace(
                "$channelName$",
                message.channel.type === "dm"
                    ? message.author.tag
                    : message.channel.name
            )
            .replace("$channelTag$", message.channel.toString())
            .replace(
                "$serverName$",
                message.guild?.name || message.author.toString()
            )
            .replace("$timestamp$", message.createdAt.toLocaleString());
    }
}

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
