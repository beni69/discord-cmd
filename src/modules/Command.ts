import Discord from "discord.js";
import { Arguments } from "yargs";
import Handler from "./Handler";
import { Logger } from "./Logging";

export default class Command {
    opts: CommandOptions & { names: string[] };
    run: CommandCallback;

    constructor(opts: CommandOptions, run: CommandCallback) {
        this.run = run;
        this.opts = opts as CommandOptions & { names: string[] };

        // if name is "name" convert it to "[name]"
        if (typeof opts.names === "string") this.opts.names = [opts.names];

        // convert cooldowns
        const toMillisec = (str: string) => {
            if (str.endsWith("ms") || /^\d+$/.test(str)) return parseInt(str);
            else if (str.endsWith("s")) return parseInt(str) * 1000;
            else if (str.endsWith("m")) return parseInt(str) * 60000;
            else if (str.endsWith("h")) return parseInt(str) * 3600000;
            else if (str.endsWith("d")) return parseInt(str) * 86400000;
            else
                throw new Error(
                    `Cooldown for command ${this.opts.names[0]} is not in a valid format.`
                );
        };

        if (opts.cooldown)
            this.opts.cooldown = toMillisec(opts.cooldown.toString());
        if (opts.globalCooldown)
            this.opts.globalCooldown = toMillisec(
                opts.globalCooldown.toString()
            );
    }
}

export type CommandOptions = {
    names: string[] | string;
    description?: string;
    category?: string;
    adminOnly?: boolean;
    noDM?: boolean;
    test?: boolean;
    react?: Discord.EmojiIdentifierResolvable;
    backlist?: Array<Discord.Snowflake>;
    minArgs?: number;
    maxArgs?: number;
    cooldown?: number | string;
    globalCooldown?: number | string;
};
export type CommandParams = {
    client: Discord.Client;
    message: Discord.Message;
    args: string[];
    argv: Arguments;
    prefix: string;
    handler: Handler;
    text: string;
    logger?: Logger;
};

export type CommandCallback = (params: CommandParams) => any;
