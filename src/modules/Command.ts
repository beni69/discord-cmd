import Discord from "discord.js";
import { Arguments } from "yargs";
import Handler from "./Handler";
import { Logger } from "./Logging";
import { toMillisec } from "./Utils";

export default class Command {
    opts: CommandOptions & { names: string[] };
    run: CommandCallback;

    constructor(opts: CommandOptions, run: CommandCallback) {
        this.run = run;
        this.opts = opts as CommandOptions & { names: string[] };

        // if name is "name" convert it to "[name]"
        if (typeof opts.names === "string") this.opts.names = [opts.names];

        if (opts.cooldown) {
            const cd = toMillisec(opts.cooldown.toString());
            if (!cd)
                throw new Error(
                    `Cooldown for command ${this.opts.names[0]} is not in a valid format.`
                );
            this.opts.cooldown = cd;
        }

        if (opts.globalCooldown) {
            const cd = toMillisec(opts.globalCooldown.toString());
            if (!cd)
                throw new Error(
                    `Global cooldown for command ${this.opts.names[0]} is not in a valid format.`
                );
            this.opts.globalCooldown = cd;
        }
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
