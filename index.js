require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");
const { Pool } = require("pg");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
});

pool.connect()
    .then(() => console.log("Bazaga muvaffaqiyatli ulandi! ✅"))
    .catch((err) => console.error("Baza ulanishida xato: ❌", err.message));

bot.use(session());

bot.catch((err, ctx) => {
    console.error(`Botda xato:`, err);
});

const REQUIRED_CHANNEL = "@EshrefRuya_Yeralti";

async function checkSub(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(
            REQUIRED_CHANNEL,
            ctx.from.id,
        );
        return ["creator", "administrator", "member"].includes(member.status);
    } catch (e) {
        return true;
    }
}

const userMenu = Markup.keyboard([
    ["🎬 Seriallar", "💰 Hisobni to'ldirish"],
    ["👤 Mening hisobim"],
]).resize();

const adminMenu = Markup.keyboard([
    ["➕ Yangi serial qo'shish", "📊 Statistika"],
    ["💸 Narxni o'zgartirish", "📢 Rassilka"],
    ["🏠 Foydalanuvchi menyusi"],
]).resize();

bot.start(async (ctx) => {
    try {
        const isSubscribed = await checkSub(ctx);
        if (!isSubscribed) {
            return ctx.reply(
                `Botdan foydalanish uchun ${REQUIRED_CHANNEL} kanalimizga a'zo bo'ling!`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.url(
                            "Kanalga a'zo bo'lish",
                            `https://t.me/${REQUIRED_CHANNEL.replace("@", "")}`,
                        ),
                    ],
                    [Markup.button.callback("Tekshirish ✅", "verify")],
                ]),
            );
        }
        await pool.query(
            "INSERT INTO users (id, balance) VALUES ($1, 0) ON CONFLICT (id) DO NOTHING",
            [ctx.from.id],
        );
        ctx.reply(
            ctx.from.id === ADMIN_ID
                ? "Xush kelibsiz, Admin!"
                : "Xush kelibsiz!",
            ctx.from.id === ADMIN_ID ? adminMenu : userMenu,
        );
    } catch (e) {
        console.error(e);
    }
});

bot.action("verify", async (ctx) => {
    if (await checkSub(ctx)) {
        await ctx.deleteMessage();
        ctx.reply(
            "Rahmat! Endi botdan foydalanishingiz mumkin. /start bosing.",
        );
    } else {
        ctx.answerCbQuery("Hali obuna bo'lmagansiz! ❌", { show_alert: true });
    }
});

// --- PROFIL BO'LIMI (LINKLAR BILAN) ---
bot.hears("👤 Mening hisobim", async (ctx) => {
    try {
        const userRes = await pool.query(
            "SELECT balance, subscriptions, created_at FROM users WHERE id = $1",
            [ctx.from.id],
        );
        const user = userRes.rows[0];
        const payRes = await pool.query(
            "SELECT SUM(amount) as total FROM payments WHERE user_id = $1",
            [ctx.from.id],
        );
        const totalSpent = payRes.rows[0].total || 0;
        const regDate = user.created_at
            ? new Date(user.created_at).toLocaleDateString("uz-UZ")
            : "Noma'lum";

        let text = `<b>👤 Sizning profilingiz</b>\n\n`;
        text += `🆔 ID: <code>${ctx.from.id}</code>\n`;
        text += `📅 Ro'yxatdan o'tgan: <b>${regDate}</b>\n`;
        text += `💳 Balans: <b>${user.balance} so'm</b>\n`;
        text += `💰 Jami to'ldirilgan: <b>${totalSpent} so'm</b>\n\n`;

        let subsText = "Hali obunalar yo'q.";
        if (user.subscriptions?.length > 0) {
            const list = await Promise.all(
                user.subscriptions.map(async (k) => {
                    const s = await pool.query(
                        "SELECT name, link FROM series WHERE key = $1",
                        [k],
                    );
                    // HTML formatida link berish (Ishonchliroq)
                    return s.rows[0]
                        ? `🎬 <a href="${s.rows[0].link}">${s.rows[0].name}</a>`
                        : null;
                }),
            );
            const filteredList = list.filter((l) => l !== null);
            if (filteredList.length > 0) subsText = filteredList.join("\n");
        }
        text += `🍿 <b>Sizning seriallaringiz:</b>\n${subsText}`;

        ctx.replyWithHTML(text, {
            disable_web_page_preview: true,
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📜 To'lovlar tarixi", "view_history")],
            ]),
        });
    } catch (e) {
        console.error(e);
    }
});

// --- RAD ETISH VA TASDIQLASH (TUZATILGAN) ---
// bot.on("text", async (ctx) => {
//     try {
//         const text = ctx.message.text;

//         // Admin chekka reply qilsa
//         if (ctx.from.id === ADMIN_ID && ctx.message.reply_to_message?.photo) {
//             const caption = ctx.message.reply_to_message.caption || "";
//             // ID ni topish uchun kuchaytirilgan regex (🆔 va bo'shliqlarni hisobga oladi)
//             const tidMatch = caption.match(/ID:\s*(\d+)/) || caption.match(/🆔 ID:\s*(\d+)/);
//             const tid = tidMatch ? tidMatch[1] : null;

//             if (!tid) return ctx.reply("Xato: Rasm ostidan ID topilmadi! ❌");

//             if (/^\d+$/.test(text)) { // Faqat raqam bo'lsa - TASDIQLASH
//                 const amount = parseInt(text);
//                 await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, tid]);
//                 await pool.query("INSERT INTO payments (user_id, amount) VALUES ($1, $2)", [tid, amount]);
//                 bot.telegram.sendMessage(tid, `Hisobingiz ${amount} so'mga to'ldirildi! ✅`).catch(() => {});
//                 return ctx.reply(`✅ ID: ${tid} balansiga ${amount} so'm qo'shildi.`);
//             } else { // Matn bo'lsa - RAD ETISH
//                 bot.telegram.sendMessage(tid, `Siz yuborgan to'lov cheki rad etildi. ❌\n\nSabab: ${text}`).catch(() => {});
//                 return ctx.reply(`❌ ID: ${tid} ga rad xabari ketdi.`);
//             }
//         }

//         // Admin sessionlari (Serial qo'shish va h.k)
//         if (ctx.session && ctx.from.id === ADMIN_ID) {
//             const step = ctx.session.step;
//             if (step === "broadcast") {
//                 const users = await pool.query("SELECT id FROM users");
//                 users.rows.forEach(u => bot.telegram.sendMessage(u.id, text).catch(() => {}));
//                 ctx.session = null; return ctx.reply("Yuborildi!");
//             } else if (step === "waiting_name") {
//                 ctx.session.name = text; ctx.session.step = "waiting_key"; return ctx.reply("Kalit so'z:");
//             } else if (step === "waiting_key") {
//                 ctx.session.key = text.toLowerCase(); ctx.session.step = "waiting_price"; return ctx.reply("Narxi:");
//             } else if (step === "waiting_price") {
//                 ctx.session.price = parseInt(text); ctx.session.step = "waiting_link"; return ctx.reply("Link:");
//             } else if (step === "waiting_link") {
//                 await pool.query("INSERT INTO series (key, name, price, link) VALUES ($1, $2, $3, $4)", [ctx.session.key, ctx.session.name, ctx.session.price, text]);
//                 ctx.session = null; return ctx.reply("Qo'shildi! ✅", adminMenu);
//             }
//         }

//         // Oddiy foydalanuvchi yozsa (Fikr bildirish)
//         if (ctx.from.id !== ADMIN_ID) {
//             bot.telegram.sendMessage(ADMIN_ID, `📩 <b>Fikr keldi:</b>\n👤: ${ctx.from.first_name}\n🆔: <code>${ctx.from.id}</code>\n💬: ${text}`, { parse_mode: "HTML" });
//         }
//     } catch (e) { console.error(e); }
// });
bot.on("text", async (ctx) => {
    try {
        const text = ctx.message.text;

        // --- ADMIN JAVOBI (TASDIQLASH, RAD ETISH YOKI ODDIY JAVOB) ---
        if (ctx.from.id === ADMIN_ID && ctx.message.reply_to_message) {
            const replyTo = ctx.message.reply_to_message;
            const caption = replyTo.caption || replyTo.text || "";

            // ID ni qidirish
            const tidMatch =
                caption.match(/ID:\s*(\d+)/) || caption.match(/🆔 ID:\s*(\d+)/);
            const tid = tidMatch ? tidMatch[1] : null;

            if (tid) {
                // 1. Agar bu rasm bo'lsa va raqam yozilgan bo'lsa - TASDIQLASH
                if (replyTo.photo && /^\d+$/.test(text)) {
                    const amount = parseInt(text);
                    await pool.query(
                        "UPDATE users SET balance = balance + $1 WHERE id = $2",
                        [amount, tid],
                    );
                    await pool.query(
                        "INSERT INTO payments (user_id, amount) VALUES ($1, $2)",
                        [tid, amount],
                    );
                    bot.telegram
                        .sendMessage(
                            tid,
                            `Hisobingiz ${amount} so'mga to'ldirildi! ✅`,
                        )
                        .catch(() => {});
                    return ctx.reply(
                        `✅ ID: ${tid} balansiga ${amount} so'm qo'shildi.`,
                    );
                }

                // 2. Agar bu rasm bo'lsa va matn yozilgan bo'lsa - RAD ETISH
                else if (replyTo.photo) {
                    bot.telegram
                        .sendMessage(
                            tid,
                            `Siz yuborgan to'lov cheki rad etildi. ❌\n\nSabab: ${text}`,
                        )
                        .catch(() => {});
                    return ctx.reply(`❌ ID: ${tid} ga rad xabari ketdi.`);
                }

                // 3. Agar bu foydalanuvchining FIKRIga javob bo'lsa
                else {
                    bot.telegram
                        .sendMessage(tid, `<b>Admin javobi:</b>\n\n${text}`, {
                            parse_mode: "HTML",
                        })
                        .catch(() => {});
                    return ctx.reply(`📩 Javobingiz ID: ${tid} ga yuborildi.`);
                }
            }
        }

        // --- ADMIN SESSIONLARI (SERIAL QO'SHISH VA H.K) ---
        if (ctx.session && ctx.from.id === ADMIN_ID) {
            const step = ctx.session.step;
            if (step === "broadcast") {
                const users = await pool.query("SELECT id FROM users");
                users.rows.forEach((u) =>
                    bot.telegram.sendMessage(u.id, text).catch(() => {}),
                );
                ctx.session = null;
                return ctx.reply("Yuborildi!");
            } else if (step === "waiting_name") {
                ctx.session.name = text;
                ctx.session.step = "waiting_key";
                return ctx.reply("Kalit so'z:");
            } else if (step === "waiting_key") {
                ctx.session.key = text.toLowerCase();
                ctx.session.step = "waiting_price";
                return ctx.reply("Narxi:");
            } else if (step === "waiting_price") {
                ctx.session.price = parseInt(text);
                ctx.session.step = "waiting_link";
                return ctx.reply("Link:");
            } else if (step === "waiting_link") {
                await pool.query(
                    "INSERT INTO series (key, name, price, link) VALUES ($1, $2, $3, $4)",
                    [
                        ctx.session.key,
                        ctx.session.name,
                        ctx.session.price,
                        text,
                    ],
                );
                ctx.session = null;
                return ctx.reply("Qo'shildi! ✅", adminMenu);
            }
        }

        // --- ODDIY FOYDALANUVCHI YOZSA (FIKR BILDIRISH) ---
        if (ctx.from.id !== ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `📩 <b>Fikr keldi:</b>\n👤: ${ctx.from.first_name}\n🆔 ID: <code>${ctx.from.id}</code>\n💬: ${text}`,
                { parse_mode: "HTML" },
            );
            ctx.reply("Xabaringiz adminga yetkazildi. Rahmat!");
        }
    } catch (e) {
        console.error(e);
    }
});

// --- SOTIB OLISH ---
bot.action(/buy_(.+)/, async (ctx) => {
    try {
        const key = ctx.match[1];
        const userRes = await pool.query(
            "SELECT balance, subscriptions FROM users WHERE id = $1",
            [ctx.from.id],
        );
        const serieRes = await pool.query(
            "SELECT * FROM series WHERE key = $1",
            [key],
        );
        const user = userRes.rows[0];
        const serie = serieRes.rows[0];

        if (user.subscriptions?.includes(key))
            return ctx.answerCbQuery("Sizda obuna bor!", { show_alert: true });
        if (user.balance < serie.price)
            return ctx.answerCbQuery("Mablag' yetarli emas! ❌", {
                show_alert: true,
            });

        await pool.query(
            "UPDATE users SET balance = balance - $1, subscriptions = array_append(subscriptions, $2) WHERE id = $3",
            [serie.price, key, ctx.from.id],
        );
        ctx.editMessageText(
            `Muvaffaqiyatli sotib olindi! 🎉\n\n🍿 ${serie.name}\n🔗 Havola: ${serie.link}`,
            { link_preview_options: { is_disabled: true } },
        );

        // 24 soatdan keyin xabar
        setTimeout(
            () => {
                bot.telegram
                    .sendMessage(
                        ctx.from.id,
                        `Kecha <b>${serie.name}</b> kanalini sotib olgandingiz. Yoqdimi? Bot haqida fikringizni yozing!`,
                        { parse_mode: "HTML" },
                    )
                    .catch(() => {});
            },
            24 * 60 * 60 * 1000,
        );

        bot.telegram
            .sendMessage(
                ADMIN_ID,
                `💰 Yangi xarid: ${serie.name}\n👤: ${ctx.from.first_name}`,
            )
            .catch(() => {});
    } catch (e) {
        console.error(e);
    }
});

// --- QOLGAN FUNKSIYALAR ---
bot.hears("🎬 Seriallar", async (ctx) => {
    const res = await pool.query("SELECT * FROM series");
    if (res.rows.length === 0) return ctx.reply("Hozircha yo'q.");
    const buttons = res.rows.map((s) => [
        Markup.button.callback(`${s.name} - ${s.price} so'm`, `buy_${s.key}`),
    ]);
    ctx.reply("🎬 Tanlang:", Markup.inlineKeyboard(buttons));
});

bot.hears("📊 Statistika", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = (await pool.query("SELECT COUNT(*) FROM users")).rows[0]
        .count;
    const income =
        (await pool.query("SELECT SUM(amount) FROM payments")).rows[0].sum || 0;
    ctx.reply(`📊 Foydalanuvchilar: ${users}\n💰 Daromad: ${income} so'm`);
});

bot.hears("💰 Hisobni to'ldirish", (ctx) => {
    ctx.reply(
        "Karta: 8600530431452237\nEgasi: Raxmanova M\n\n⚠️ Chekni faqat rasm qilib yuboring!",
    );
});

bot.on("photo", async (ctx) => {
    if (ctx.from.id === ADMIN_ID) return;
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    bot.telegram.sendPhoto(ADMIN_ID, photoId, {
        caption: `💰 <b>Yangi to'lov!</b>\n👤: ${ctx.from.first_name}\n🆔 ID: <code>${ctx.from.id}</code>\n\nSummani yozing (faqat raqam) yoki rad sababini yozing.`,
        parse_mode: "HTML",
    });
    ctx.reply("Chek yuborildi. Tasdiqlanishini kuting.");
});

bot.action("view_history", async (ctx) => {
    const payRes = await pool.query(
        "SELECT amount, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10",
        [ctx.from.id],
    );
    if (payRes.rows.length === 0)
        return ctx.answerCbQuery("Tarix bo'sh.", { show_alert: true });
    let text = "📜 Oxirgi to'lovlar:\n\n";
    payRes.rows.forEach((p) => {
        text += `🔹 ${new Date(p.created_at).toLocaleDateString()} — ${p.amount} so'm\n`;
    });
    ctx.reply(text);
});

bot.launch().then(() => console.log("Bot onlayn! 🚀"));
