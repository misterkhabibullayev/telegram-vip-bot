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

bot.help((ctx) => {
    const adminUsername = "misterkhabibullayev";
    const text = "Assalomu alaykum, botda obuna sotib olishda yordam bering";
    const encodedText = encodeURIComponent(text);
    ctx.reply(
        "Botda obuna sotib olishga qiynalayotgan bo'lsangiz adminga murojaat qiling.",
        Markup.inlineKeyboard([
            [
                Markup.button.url(
                    "Admin bilan bog'lanish 👨‍💻",
                    `https://t.me/${adminUsername}?text=${encodedText}`,
                ),
            ],
        ]),
    );
});

bot.hears("🎬 Seriallar", async (ctx) => {
    try {
        const res = await pool.query("SELECT * FROM series");
        if (res.rows.length === 0) return ctx.reply("Hozircha seriallar yo'q.");
        const buttons = res.rows.map((s) => [
            Markup.button.callback(
                `${s.name} - ${s.price} so'm`,
                `buy_${s.key}`,
            ),
        ]);
        ctx.reply("🎬 Serialni tanlang:", Markup.inlineKeyboard(buttons));
    } catch (e) {
        console.error(e);
    }
});

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

        bot.telegram
            .sendMessage(
                ADMIN_ID,
                `💰 **Yangi Xarid!**\n\n👤: ${ctx.from.first_name}\n🆔: \`${ctx.from.id}\`\n🎬: ${serie.name}\n💸: ${serie.price} so'm`,
                { parse_mode: "Markdown" },
            )
            .catch(() => {});
    } catch (e) {
        console.error(e);
    }
});

bot.hears("👤 Mening hisobim", async (ctx) => {
    try {
        const res = await pool.query(
            "SELECT balance, subscriptions FROM users WHERE id = $1",
            [ctx.from.id],
        );
        const user = res.rows[0];
        let subsText = "Obunalar yo'q.";
        if (user.subscriptions?.length > 0) {
            const list = await Promise.all(
                user.subscriptions.map(async (k) => {
                    const s = await pool.query(
                        "SELECT name, link FROM series WHERE key = $1",
                        [k],
                    );
                    return s.rows[0]
                        ? `🔹 [${s.rows[0].name}](${s.rows[0].link})`
                        : null;
                }),
            );
            subsText = list.filter((l) => l !== null).join("\n");
        }
        ctx.replyWithMarkdown(
            `💳 Balans: *${user.balance} so'm*\n\n✅ Obunalar:\n${subsText}`,
            { link_preview_options: { is_disabled: true } },
        );
    } catch (e) {
        console.error(e);
    }
});

bot.hears("📊 Statistika", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = (await pool.query("SELECT COUNT(*) FROM users")).rows[0]
        .count;
    const income =
        (await pool.query("SELECT SUM(amount) FROM payments")).rows[0].sum || 0;
    ctx.replyWithMarkdown(
        `📊 *Statistika:*\n\n👥 Foydalanuvchilar: ${users}\n💰 Daromad: ${income} so'm`,
    );
});

bot.hears("📢 Rassilka", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.session = { step: "broadcast" };
    ctx.reply("Xabarni kiriting:");
});

bot.hears("💰 Hisobni to'ldirish", (ctx) => {
    ctx.reply(
        "Karta: 8600530431452237\nEgasi: Raxmanova M\n\n⚠️ To'lovdan so'ng chekni rasm ko'rinishida yuboring!",
    );
});

bot.on("photo", async (ctx) => {
    if (ctx.from.id === ADMIN_ID) return;

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fullName =
        `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim();

    bot.telegram.sendPhoto(ADMIN_ID, photoId, {
        caption:
            `💰 **Yangi to'lov!**\n\n` +
            `👤 Foydalanuvchi: **${fullName}**\n` +
            `🆔 ID: <code>${ctx.from.id}</code>\n\n` +
            `Summani yozing (yoki rad sababini)`,
        parse_mode: "HTML",
    });

    ctx.reply("Chek yuborildi. Tasdiqlanishini kuting.");
});

bot.hears("➕ Yangi serial qo'shish", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.session = { step: "waiting_name" };
    ctx.reply("Serial nomi:");
});

bot.on("text", async (ctx) => {
    try {
        const text = ctx.message.text;

        // --- TO'LOV TASDIQLASH/RAD ETISH ---
        if (ctx.from.id === ADMIN_ID && ctx.message.reply_to_message?.photo) {
            const tid =
                ctx.message.reply_to_message.caption.match(/ID: (\d+)/)?.[1];
            if (!tid) return;

            if (/^\d+$/.test(text)) {
                // Faqat raqam bo'lsa - TASDIQLASH
                const amount = parseInt(text);
                await pool.query(
                    "UPDATE users SET balance = balance + $1 WHERE id = $2",
                    [amount, tid],
                );
                await pool.query(
                    "INSERT INTO payments (user_id, amount) VALUES ($1, $2)",
                    [tid, amount],
                );
                bot.telegram.sendMessage(
                    tid,
                    `Hisobingiz ${amount} so'mga to'ldirildi! ✅`,
                );
                return ctx.reply(`ID: ${tid} balansiga ${amount} qo'shildi.`);
            } else {
                // Matn bo'lsa - RAD ETISH
                bot.telegram.sendMessage(
                    tid,
                    `To'lovingiz rad etildi. ❌\nSabab: ${text}`,
                );
                return ctx.reply(`ID: ${tid} ga rad xabari ketdi.`);
            }
        }

        // --- ADMIN SESSIONLARI ---
        if (ctx.session && ctx.from.id === ADMIN_ID) {
            const step = ctx.session.step;
            if (step === "broadcast") {
                const users = await pool.query("SELECT id FROM users");
                users.rows.forEach((u) =>
                    bot.telegram.sendMessage(u.id, text).catch(() => {}),
                );
                ctx.session = null;
                return ctx.reply("Xabar yuborildi!");
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
    } catch (e) {
        console.error(e);
    }
});

bot.launch().then(() => console.log("Bot onlayn! 🚀"));
