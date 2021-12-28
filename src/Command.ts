import {
    ApplicationCommandOptionData,
    Client,
    CommandInteractionOptionResolver,
    EmojiIdentifierResolvable,
    Snowflake,
} from "discord.js";
import ms from "ms";
import Handler from "./Handler";
import { Logger } from "./Logging";
import { ClassicTrigger, SlashTrigger } from "./Trigger";

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
        this.opts.names = this.opts.names.map(str => str.toLowerCase());

        if (opts.cooldown) {
            const cd = ms(opts.cooldown.toString());
            if (!cd)
                throw new Error(
                    `Cooldown for command ${this.opts.names[0]} is not in a valid format.`
                );
            this.opts.cooldown = cd;
        }

        if (opts.globalCooldown) {
            const cd = ms(opts.globalCooldown.toString());
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
    /** command can not be invoked by a message */
    noClassic?: boolean;
    /** command can not be invoked by a slash command */
    noSlash?: boolean;
    /** command can not be invoked in direct messages */
    noDM?: boolean;
    /** allow command usage only to pre-registered admins */
    adminOnly?: boolean;
    /** command can only be used on a pre-registered test server */
    test?: boolean;
    blacklist?: Array<Snowflake>;
    /** per-user cooldown */
    cooldown?: number | string;
    /** per-guild cooldown */
    globalCooldown?: number | string;
    // classic
    /** emoji to react on the original message with on command success */
    react?: EmojiIdentifierResolvable;
    minArgs?: number;
    maxArgs?: number;
    /** whether to use arguments based on postion or flag syntax */
    yargs?: boolean;
    /** aliases to flag syntax arguments */
    argvAliases?: { [key: string]: string[] };
    // slash
    options?: Array<ApplicationCommandOptionData>;
    /** only the original user can see the reply */
    ephemeral?: boolean;
    /** extend available response time by instantly sending a "waiting" thingy */
    deferred?: boolean;
};
export type CommandParams = {
    client: Client;
    trigger: ClassicTrigger | SlashTrigger;
    args: string[];
    argv: CommandInteractionOptionResolver;
    prefix: string;
    handler: Handler;
    text: string;
    logger?: Logger;
};
export type CommandCallback = (
    params: CommandParams
) => Promise<boolean | void> | boolean | void;
