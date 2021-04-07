import { MessageEmbed, MessageEmbedOptions } from "discord.js";
import * as models from "./Models";

// convert strings like "5m" and "24h" to milliseconds
export function toMillisec(str: string) {
    if (str.endsWith("ms") || /^\d+$/.test(str)) return parseInt(str);
    else if (str.endsWith("s")) return parseInt(str) * 1000;
    else if (str.endsWith("m")) return parseInt(str) * 60000;
    else if (str.endsWith("h")) return parseInt(str) * 3600000;
    else if (str.endsWith("d")) return parseInt(str) * 86400000;
    else return null;
}

// convert milliseconds to strings like "2 hours 5 minutes"
export function toTime(M: number, stringify = false) {
    M /= 1000;
    const h = Math.floor(M / 3600);
    const m = Math.floor((M % 3600) / 60);
    const s = Math.floor((M % 3600) % 60);

    if (stringify) {
        let str = "";
        str += h ? `${h} hours ` : "";
        str += m ? `${m} minutes ` : "";
        str += s ? `${s} seconds ` : "";

        return str.trim();
    }

    return { M, h, m, s };
}

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
