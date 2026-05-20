require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");
const { Pool } = require("pg");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// --- BAZA BILAN BARQAROR ULANISH ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
});

pool.connect()
    .then(() => console.log("Bazaga muvaffaqiyatli ulandi! ✅"))
    .catch((err) => console.error("Baza ulanishida xato: ❌", err.message));

bot.use(session());

// --- TEXNIK ISHLAR HOLATI ---
let isMaintenanceMode = false; // Xotirada saqlanadi

// Global xatolikni tutish
bot.catch((err, ctx) => {
    console.error(`Botda xato:`, err);
});

// --- MAJBURIY OBUNA SOZLAMASI ---
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

// --- MENYULAR ---
const userMenu = Markup.keyboard([
    ["🎬 Seriallar", "💰 Hisobni to'ldirish"],
    ["👤 Mening hisobim"],
]).resize();

const adminMenu = Markup.keyboard([
    ["➕ Yangi serial qo'shish", "📊 Statistika"],
    ["💸 Narxni o'zgartirish", "📢 Rassilka"],
    ["⚙️ Texnik ishlar (ON/OFF)", "🏠 Foydalanuvchi menyusi"], // Yangi tugma
]).resize();

// --- 1. TEXNIK ISHLAR MIDDLEWARE (Barcha tugmalarni to'xtatadi) ---
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === ADMIN_ID) return next(); // Admin uchun doim ochiq

    if (isMaintenanceMode) {
        const text = ctx.message?.text || ""; // Faqat /start buyrug'ida ham, boshqa har qanday harakatda ham bir xil javob
        return ctx.reply(
            "⚠️ Botda texnik ishlar bo'lyapti.\n\nTexnik ishlar tugagandan keyin sizga xabar beriladi. Shundan keyin bemalol bot xizmatlaridan foydalanishingiz mumkin bo'ladi.",
        );
    }
    return next();
});

// --- TO'LOV KUTAYOTGAN FOYDALANUVCHILAR UCHUN MIDDLEWARE ---
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === ADMIN_ID) return next();

    const text = ctx.message?.text || "";
    if (text !== "/start" && text !== "/help" && !ctx.callbackQuery) {
        const userRes = await pool.query(
            "SELECT is_waiting_payment FROM users WHERE id = $1",
            [ctx.from.id],
        );
        if (userRes.rows[0]?.is_waiting_payment) {
            return ctx.reply(
                "⚠️ Siz yuborgan chek hali ko'rib chiqilmoqda. Tasdiqlanganidan keyin botdan foydalanishingiz mumkin.",
            );
        }
    }
    return next();
});

// --- 2. MAJBURIY OBUNA MIDDLEWARE ---
bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();

    const text = ctx.message?.text || "";
    const callbackData = ctx.callbackQuery?.data || "";

    if (callbackData === "verify" || text === "/start") return next();

    const isSubscribed = await checkSub(ctx);
    if (!isSubscribed) {
        return ctx.reply(
            `Kanalga a'zo bo'lmagansiz! ❌\nIltimos, avval @EshrefRuya_Yeralti kanaliga a'zo bo'ling, so'ngra /start bosing.`,
            Markup.inlineKeyboard([
                [
                    Markup.button.url(
                        "Kanalga a'zo bo'lish",
                        `https://t.me/EshrefRuya_Yeralti`,
                    ),
                ],
            ]),
        );
    }
    return next();
});

// --- ADMIN: TEXNIK ISHLARNI BOSHQARISH ---
bot.hears("⚙️ Texnik ishlar (ON/OFF)", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    isMaintenanceMode = !isMaintenanceMode;

    if (isMaintenanceMode) {
        ctx.reply(
            "🚫 Texnik ishlar rejimi YOQILDI. Foydalanuvchilar bloklandi.",
        );
    } else {
        ctx.reply(
            "✅ Texnik ishlar rejimi O'CHIRILDI. Bot barcha uchun ochiq.",
        ); // Foydalanuvchilarga xabar yuborish (Xohlasangiz)

        const users = await pool.query("SELECT id FROM users");
        users.rows.forEach((u) => {
            bot.telegram
                .sendMessage(
                    u.id,
                    "✅ Texnik ishlar tugadi! Botdan bemalol foydalanishingiz mumkin.",
                )
                .catch(async (error) => {
                    // Agar foydalanuvchi botni bloklagan bo'lsa, bazada yangilaymiz
                    if (
                        error.description ===
                        "Forbidden: bot was blocked by the user"
                    ) {
                        await pool.query(
                            "UPDATE users SET status = 'blocked' WHERE id = $1",
                            [u.id],
                        );
                    }
                });
        });
    }
});

// --- START ---
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

        // Foydalanuvchi bazaga qo'shilganda yoki qayta start bosganda statusini 'active' qilamiz
        await pool.query(
            "INSERT INTO users (id, balance, status) VALUES ($1, 0, 'active') ON CONFLICT (id) DO UPDATE SET status = 'active'",
            [ctx.from.id],
        );
        ctx.reply(
            ctx.from.id === ADMIN_ID
                ? "Xush kelibsiz, Admin!"
                : "Xush kelibsiz! Kerakli bo'limni tanlang:",
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

// Help
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

// --- ADMIN: BALANSNI MASOFAVIY BOSHQARISH ---
bot.command("set", async (ctx) => {
    // Faqat admin ishlata olishi uchun tekshiruv
    if (ctx.from.id !== ADMIN_ID) return;

    try {
        const args = ctx.message.text.split(" "); // Buyruqni qismlarga bo'lamiz
        // Format: /set balance 12345678 50000

        if (args.length === 4 && args[1] === "balance") {
            const tid = args[2]; // Foydalanuvchi ID
            const amount = parseInt(args[3]); // Yangi balans miqdori

            if (isNaN(amount)) {
                return ctx.reply("❌ Xato: Summa raqam bo'lishi kerak.");
            } // Bazada balansni yangilash (SET buyrug'i hisobni aynan o'sha raqamga tenglaydi)

            const res = await pool.query(
                "UPDATE users SET balance = $1 WHERE id = $2 RETURNING id",
                [amount, tid],
            );

            if (res.rowCount > 0) {
                // Foydalanuvchini ogohlantirish (ixtiyoriy)
                bot.telegram
                    .sendMessage(
                        tid,
                        `Sizning balansingiz admin tomonidan yangilandi. ✅\nJoriy balans: ${amount} so'm`,
                    )
                    .catch(async (error) => {
                        if (
                            error.description ===
                            "Forbidden: bot was blocked by the user"
                        ) {
                            await pool.query(
                                "UPDATE users SET status = 'blocked' WHERE id = $1",
                                [tid],
                            );
                        }
                    });
                return ctx.reply(
                    `✅ Muvaffaqiyatli: ID ${tid} balansi ${amount} so'mga o'zgartirildi.`,
                );
            } else {
                return ctx.reply(
                    "❌ Xato: Bunday ID dagi foydalanuvchi topilmadi.",
                );
            }
        } else {
            return ctx.reply(
                "ℹ️ To'g'ri format:\n`/set balance [ID] [SUMMA]`\n\nMisol:\n`/set balance 8553587912 0` (hisobni nol qilish)\n`/set balance 8553587912 50000` (hisobni 50 ming qilish)",
                { parse_mode: "Markdown" },
            );
        }
    } catch (e) {
        console.error("Admin set command error:", e);
        ctx.reply("Xatolik yuz berdi. ❌");
    }
});

// --- SERIALAR ---
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

        // Foydalanuvchi nomini hyperlink qilish
        const userLink = `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;

        bot.telegram
            .sendMessage(
                ADMIN_ID,
                `💰 **Yangi Xarid!**\n\n👤 Foydalanuvchi: ${userLink}\n🆔 ID: \`${ctx.from.id}\`\n🎬 Serial: **${serie.name}**`,
                { parse_mode: "Markdown" },
            )
            .catch(() => {});
    } catch (e) {
        console.error(e);
    }
});

// --- MENING HISOBIM ---
bot.hears("👤 Mening hisobim", async (ctx) => {
    try {
        const res = await pool.query(
            "SELECT balance, subscriptions FROM users WHERE id = $1",
            [ctx.from.id],
        );
        const user = res.rows[0]; // Foydalanuvchi ismini havolali qilish
        const userLink = `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;
        let subsText = "_Sizda faol obunalar mavjud emas._";
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
            const filteredList = list.filter((l) => l !== null);
            if (filteredList.length > 0) {
                subsText = filteredList.join("\n");
            }
        } // Ma'lumotlarni chiroyli formatda chiqarish

        const profileMessage =
            `👤 *Foydalanuvchi:* ${userLink}\n` +
            `🆔 *Sizning ID:* \`${ctx.from.id}\`\n` +
            `💳 *Balans:* ${user.balance} so'm\n\n` +
            `✅ *Sizning obunalaringiz:* \n${subsText}`;

        await ctx.replyWithMarkdownV2(
            profileMessage
                .replace(/\./g, "\\.")
                .replace(/-/g, "\\-")
                .replace(/!/g, "\\!"), // MarkdownV2 belgilarini "escape" qilish
            { disable_web_page_preview: true },
        );
    } catch (e) {
        console.error("Hisobimda xatolik:", e);
        ctx.reply("Ma'lumotlarni yuklashda xatolik yuz berdi. ❌");
    }
});

bot.hears("💰 Hisobni to'ldirish", (ctx) => {
    const userIdStr = String(ctx.from.id);

    // Agar foydalanuvchi ID-si 8 tadan kam bo'lsa (eski akkauntlar uchun)
    if (userIdStr.length < 8) {
        const adminUsername = "misterkhabibullayev";
        const text = `Assalomu alaykum. Mening Telegram ID-m 8 xonadan kam (${ctx.from.id}). Balansimni to'ldirishda yordam bering.`;
        const encodedText = encodeURIComponent(text);

        return ctx.reply(
            "⚠️ Kechirasiz, sizning Telegram akkauntingiz juda eski (ID 8 xonadan kam) bo'lganligi sababli avtomatlashtirilgan to'lov tizimidan foydalana olmaysiz.\n\nHisobingizni to'ldirish uchun iltimos, to'g'ridan-to'g'ri adminga murojaat qiling. Admin hisobingizni qo'lda to'ldirib beradi. 🛠️",
            Markup.inlineKeyboard([
                [
                    Markup.button.url(
                        "Adminga murojaat qilish 👨‍💻",
                        `https://t.me/${adminUsername}?text=${encodedText}`,
                    ),
                ],
            ]),
        );
    }

    // ID 8 xona yoki undan ko'p bo'lgan oddiy foydalanuvchilar uchun standart xabar
    ctx.reply(
        "Pastdagi kartaga to'lov qilishiz mumkin 👇\n\nInfinBank: 8600530431452237\nKarta egasi: Raxmanova M\n\n⚠️ Eslatma: To'lovni qilib chekni rasm(Photo) ko'rinishida jo'nating!",
    );
});

bot.on("photo", async (ctx) => {
    if (ctx.from.id === ADMIN_ID) return;

    try {
        const userRes = await pool.query(
            "SELECT is_waiting_payment FROM users WHERE id = $1",
            [ctx.from.id],
        );
        if (userRes.rows[0]?.is_waiting_payment) {
            return ctx.reply(
                "⚠️ Oldingi chekingiz hali tasdiqlanmadi. Tasdiqlash biroz vaqt olishi mumkin degan xabar yuborish kerak.",
            );
        }

        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id; // Foydalanuvchi ismini havolaga aylantiramiz
        const userLink = `<a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>`;

        await bot.telegram.sendPhoto(ADMIN_ID, photoId, {
            caption: `💰 <b>Yangi to'lov!</b>\n\n👤 Foydalanuvchi: ${userLink}\n🆔 ID: <code>${ctx.from.id}</code>\n\nSummani shu rasmga reply qilib yuboring.`,
            parse_mode: "HTML",
        });

        await pool.query(
            "UPDATE users SET is_waiting_payment = TRUE WHERE id = $1",
            [ctx.from.id],
        );

        ctx.reply("Chek yuborildi. Tasdiqlanishini kuting.");
    } catch (e) {
        console.error("Photo yuborishda xato:", e);
    }
});

// --- YANGILANGAN VA MUKAMMAL STATISTIKA BO'LIMI ---
bot.hears("📊 Statistika", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    try {
        // 1. Umumiy foydalanuvchilar
        const totalUsersRes = await pool.query("SELECT COUNT(*) FROM users");
        const totalUsers = totalUsersRes.rows[0].count;

        // 2. Faol foydalanuvchilar (status = 'active')
        const activeUsersRes = await pool.query(
            "SELECT COUNT(*) FROM users WHERE status = 'active'",
        );
        const activeUsers = activeUsersRes.rows[0].count;

        // 3. Botni bloklaganlar (status = 'blocked')
        const blockedUsersRes = await pool.query(
            "SELECT COUNT(*) FROM users WHERE status = 'blocked'",
        );
        const blockedUsers = blockedUsersRes.rows[0].count;

        // 4. Esref Ruya sotib olganlar (array ichida 'esref_ruya' borlar)
        const esrefRes = await pool.query(
            "SELECT COUNT(*) FROM users WHERE 'esref_ruya' = ANY(subscriptions)",
        );
        const esrefCount = esrefRes.rows[0].count;

        // 5. Yeralti sotib olganlar (array ichida 'yeralti' borlar)
        const yeraltiRes = await pool.query(
            "SELECT COUNT(*) FROM users WHERE 'yeralti' = ANY(subscriptions)",
        );
        const yeraltiCount = yeraltiRes.rows[0].count;

        // 6. Esref Ruya uzb tilda sotib olganlar (array ichida 'esref_ruya_uzb' borlar)
        const esrefUzbRes = await pool.query(
            "SELECT COUNT(*) FROM users WHERE 'esref_ruya_uzb' = ANY(subscriptions)",
        );
        const esrefUzbCount = esrefUzbRes.rows[0].count;

        // 7. Umumiy daromad (Har bir serial narxidan kelib chiqib avtomat hisoblaydi)
        // Agarda serial narxlari boshqacha bo'lsa, pastdagi 15000 va 20000 larni o'zgartirishingiz mumkin
        const incomeRes = await pool.query(`
            SELECT COALESCE(SUM(
                (CASE WHEN 'esref_ruya' = ANY(subscriptions) THEN 15000 ELSE 0 END) +
                (CASE WHEN 'yeralti' = ANY(subscriptions) THEN 20000 ELSE 0 END) +
                (CASE WHEN 'esref_ruya_uzb' = ANY(subscriptions) THEN 15000 ELSE 0 END)
            ), 0) as total_income FROM users
        `);
        const totalIncome = incomeRes.rows[0].total_income;

        // Siz so'ragan aniq formatda xabarni tayyorlash
        const statMessage =
            `📊 **Bot Statistikasi:**\n\n` +
            `👥 Foydalanuvchilar — **${totalUsers}** ta\n` +
            `🟢 Faol foydalanuvchilar — **${activeUsers}** ta\n` +
            `🔴 Botni bloklagan foydalanuvchilar — **${blockedUsers}** ta\n\n` +
            `🎬 Esref Ruya sotib olganlar — **${esrefCount}** ta\n` +
            `🎬 Yeralti sotib olganlar — **${yeraltiCount}** ta\n` +
            `🎬 Esref Ruya uzb tilda sotib olganlar — **${esrefUzbCount}** ta\n\n` +
            `💰 Umumiy daromadi — **${Number(totalIncome).toLocaleString("uz-UZ")} so'm**`;

        await ctx.replyWithMarkdown(statMessage);
    } catch (e) {
        console.error("Statistika yuklashda xatolik:", e);
        ctx.reply("Statistikani hisoblashda xatolik yuz berdi. ❌");
    }
});

bot.hears("📢 Rassilka", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.session = { step: "broadcast" };
    ctx.reply("Barcha foydalanuvchilarga yuboriladigan xabarni kiriting:");
});

bot.hears("➕ Yangi serial qo'shish", (ctx) => {
    if (ctx.from.id === ADMIN_ID) {
        ctx.session = { step: "waiting_name" };
        ctx.reply("Serial nomini kiriting:");
    }
});

bot.hears("💸 Narxni o'zgartirish", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const res = await pool.query("SELECT key, name FROM series");
    const buttons = res.rows.map((s) => [
        Markup.button.callback(s.name, `setprice_${s.key}`),
    ]);
    ctx.reply("Serialni tanlang:", Markup.inlineKeyboard(buttons));
});

bot.hears("🏠 Foydalanuvchi menyusi", (ctx) =>
    ctx.reply("Foydalanuvchi menyusiga o'tildi.", userMenu),
);

bot.on("text", async (ctx) => {
    try {
        const text = ctx.message.text; // --- ADMIN TO'LOVNI TASDIQLASH YOKI RAD ETISH ---

        if (ctx.from.id === ADMIN_ID && ctx.message.reply_to_message?.photo) {
            const replyTo = ctx.message.reply_to_message;
            const caption = replyTo.caption || ""; // ID ni qidirish: matn ichidagi 8 tadan 12 tagacha bo'lgan raqamlarni topadi

            const tidMatch = caption.match(/\d{8,12}/);
            const tid = tidMatch ? tidMatch[0] : null;

            if (tid) {
                const amount = parseInt(text); // 1. Agar admin faqat raqam yuborgan bo'lsa - TASDIQLASH

                if (/^\d+$/.test(text.trim())) {
                    await pool.query(
                        "UPDATE users SET balance = balance + $1, is_waiting_payment = FALSE WHERE id = $2",
                        [amount, tid],
                    );
                    await pool.query(
                        "INSERT INTO payments (user_id, amount) VALUES ($1, $2)",
                        [tid, amount],
                    );

                    await bot.telegram
                        .sendMessage(
                            tid,
                            `Hisobingiz ${amount} so'mga to'ldirildi! ✅`,
                        )
                        .catch(async (error) => {
                            if (
                                error.description ===
                                "Forbidden: bot was blocked by the user"
                            ) {
                                await pool.query(
                                    "UPDATE users SET status = 'blocked' WHERE id = $1",
                                    [tid],
                                );
                            }
                        });
                    return ctx.reply(
                        `✅ ID: ${tid} balansiga ${amount} so'm qo'shildi.`,
                    );
                } else // 2. Agar admin matn yuborgan bo'lsa - RAD ETISH
                {
                    await pool.query(
                        "UPDATE users SET is_waiting_payment = FALSE WHERE id = $1",
                        [tid],
                    );
                    await bot.telegram
                        .sendMessage(
                            tid,
                            `Siz yuborgan to'lov cheki rad etildi. ❌\n\n<b>Sabab:</b> ${text}`,
                            { parse_mode: "HTML" },
                        )
                        .catch(async (error) => {
                            if (
                                error.description ===
                                "Forbidden: bot was blocked by the user"
                            ) {
                                await pool.query(
                                    "UPDATE users SET status = 'blocked' WHERE id = $1",
                                    [tid],
                                );
                            }
                        });
                    return ctx.reply(
                        `❌ ID: ${tid} ga rad xabari yuborildi.\n\nSabab: ${text}`,
                    );
                }
            } else {
                return ctx.reply(
                    "Xato: Rasm ostidan foydalanuvchi ID-si topilmadi! ❌",
                );
            }
        } // --- ADMIN SESSIONLARI (O'ZGARISHSIZ QOLDI) ---

        if (ctx.session && ctx.from.id === ADMIN_ID) {
            const step = ctx.session.step;
            if (step === "broadcast") {
                const users = await pool.query("SELECT id FROM users");
                users.rows.forEach((u) =>
                    bot.telegram
                        .sendMessage(u.id, text)
                        .catch(async (error) => {
                            if (
                                error.description ===
                                "Forbidden: bot was blocked by the user"
                            ) {
                                await pool.query(
                                    "UPDATE users SET status = 'blocked' WHERE id = $1",
                                    [u.id],
                                );
                            }
                        }),
                );
                ctx.session = null;
                return ctx.reply(
                    "Xabar hamma foydalanuvchilarga yuborildi! ✅",
                );
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
                return ctx.reply("Kanal havolasi:");
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
                return ctx.reply("Yangi serial qo'shildi! ✅", adminMenu);
            }
        }
    } catch (e) {
        console.error(e);
    }
});

bot.launch().then(() => console.log("Bot 24/7 ishga tushdi! 🚀"));
