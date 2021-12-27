import {
    Guild,
    GuildChannel,
    GuildMember,
    MessageEmbed,
    Role,
    User,
} from "discord.js";
import { ApplicationCommandOptionTypes } from "discord.js/typings/enums";
import * as models from "./Models";

// remove expired cooldowns from the database
export async function cleanDB() {
    await models.guild.find((err, found) => {
        if (err) return console.error(err);

        found.forEach(async (g: any) => {
            // per-user cooldowns
            let toDelete: number[] = [];
            g.cooldowns.forEach((cd: any, i: number) => {
                if (cd.expires < Date.now()) toDelete.push(i);
            });
            toDelete.forEach(n => g.cooldowns.splice(n, 1));

            // global cooldowns
            toDelete = [];
            g.globalCooldowns.forEach((cd: any, i: number) => {
                if (cd.expires < Date.now()) toDelete.push(i);
            });
            toDelete.forEach(n => g.globalCooldowns.splice(n, 1));

            await g.updateOne({
                cooldowns: g.cooldowns,
                globalCooldowns: g.globalCooldowns,
            });
        });
    });
}

export function newEmbed(title: string, msg: string) {
    return new MessageEmbed({ title, description: msg }).setTimestamp();
}

export const resolveUser = (str: string) => str.replace(/\<|\>|@|!/gi, "");

/**
 * get the type and resolved data (if possible) from a string
 * @example user: <@123...> or <@!123...>
 * @example role: <@&123...>
 * @example channel: <#123...>
 * @param guild the discordjs client to use for resolving
 * @param x the option to resolve
 */
export const resolveMention = (
    guild: Guild,
    x: any
): {
    type: keyof typeof ApplicationCommandOptionTypes;
    value: any;
    user?: User;
    member?: GuildMember;
    channel?: GuildChannel;
    role?: Role;
} => {
    // get built in types out of the way
    if (x === !!x) return { type: "BOOLEAN", value: x };
    if (!isNaN(parseInt(x) || parseFloat(x)))
        return { type: "NUMBER", value: x };
    // not a mention, just a regular string
    // if (!/^<(@|@!|@&|#).>$/im.test(x)) return { type: "STRING", value: x };

    let value: any = null;
    let res: any = null;

    value = /^<@!?(\d{18,20})>$/.exec(x)?.[1];
    if (value) res = guild.client.users.resolve(value);
    let member;
    if (res && "members" in guild) member = guild.members.resolve(res);
    if (res)
        return { type: "USER", value, user: res, member: member ?? undefined };

    value = /^<@&(\d{18,20})>$/.exec(x)?.[1];
    if (value) res = guild.roles.resolve(value);
    if (res) return { type: "ROLE", value, role: res };

    value = /^<#(\d{18,20})>$/.exec(x)?.[1];
    if (value) res = guild.channels.resolve(value);
    if (res) return { type: "CHANNEL", value, channel: res };

    // fallback
    return { type: "STRING", value: x };
};
