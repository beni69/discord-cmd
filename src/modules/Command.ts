import {
    ApplicationCommandOptionData,
    Client,
    Collection,
    EmojiIdentifierResolvable,
    Snowflake,
} from "discord.js";
import { Arguments } from "yargs";
import Handler from "./Handler";
import { Logger } from "./Logging";
import { Trigger } from "./Trigger";
import { toMillisec } from "./Utils";

export class Command {
    opts: CommandOptions & { names: string[] };
    run: CommandCallback;

    /**
     * Create a new command
     * @param {CommandOptions} opts - Parameters for the command
     * @param {CommandCallback} run - The actual function to run when the command is called
     */
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
export default Command;

export type CommandOptions = {
    // general
    names: string[] | string;
    description: string;
    category?: string;
    noClassic?: boolean;
    noSlash?: boolean;
    adminOnly?: boolean;
    noDM?: boolean;
    test?: boolean;
    blacklist?: Array<Snowflake>;
    cooldown?: number | string;
    globalCooldown?: number | string;
    // classic
    react?: EmojiIdentifierResolvable;
    minArgs?: number;
    maxArgs?: number;
    argvAliases?: { [key: string]: string[] };
    // slash
    options?: Array<ApplicationCommandOptionData>;
    ephemeral?: boolean;
    deferred?: boolean;
};
export type CommandParams = {
    client: Client;
    trigger: Trigger;
    args: string[];
    argv: Collection<string, any>;
    prefix: string;
    handler: Handler;
    text: string;
    logger?: Logger;
};
export type CommandCallback = (
    params: CommandParams
) => void | false | Promise<void | false>;
