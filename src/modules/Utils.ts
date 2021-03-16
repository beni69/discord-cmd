// convert strings like "5m" and "24h" to milliseconds
export function toMillisec(str: string) {
    if (str.endsWith("ms") || /^\d+$/.test(str)) return parseInt(str);
    else if (str.endsWith("s")) return parseInt(str) * 1000;
    else if (str.endsWith("m")) return parseInt(str) * 60000;
    else if (str.endsWith("h")) return parseInt(str) * 3600000;
    else if (str.endsWith("d")) return parseInt(str) * 86400000;
    else return null;
}

export function toTime(M: number) {
    const date = new Date(M);
    const y = Math.abs(date.getFullYear() - 1970);
    const m = date.getMonth();
    const d = date.getDay();
    const h = date.getHours();
    const min = date.getMinutes();
    const s = date.getSeconds();

    return { y, m, d, h, min, s };
}
