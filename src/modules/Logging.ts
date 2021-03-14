import Discord from "discord.js";

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

        process.on("unhandledRejection", error => {
            console.error("Unhandled promise rejection:", error);
            this.send(`Unhandled promise rejection:\n**${error}**`);
        });
    }

    log(message: Discord.Message, format: LoggerFormat = this.format) {
        const str = this.getFormat(message, format);

        this.channels.forEach(ch => ch.send(str));
    }
    send(str: string) {
        this.channels.forEach(ch => ch.send(str));
    }

    getFormat(message: Discord.Message, format: LoggerFormat | string) {
        format = typeof format === "object" ? format.join("") : format;
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
