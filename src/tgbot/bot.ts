import * as fs from 'fs';
import * as path from 'path';
import { StatusWith } from '../status.js';
import TelegramBot from 'node-telegram-bot-api';

type Config = {
    token: string;
}

function load_configuration(): StatusWith<Config> {
    const config_path = path.join(process.cwd(), 'botcfg.json');
    try {
        const raw = fs.readFileSync(config_path, 'utf-8');
        const config = JSON.parse(raw) as Config;
        return StatusWith.ok().with(config);
    } catch (error) {
        if (error instanceof Error) {
            return StatusWith.fail(error.message);
        }
        return StatusWith.fail(`${error}`);
    }
}

const FILES_DIR = path.join(process.cwd(), 'files');


const config_status = load_configuration();
if (!config_status.is_ok()) {
    console.error('Failed to load configuration:', config_status.what());
    process.exit(1);
}

const config = config_status.value!;
if (!config.token) {
    console.error('Token not found in botcfg.json');
    process.exit(1);
}

const bot = new TelegramBot(config.token, { polling: true });

function start(bot: TelegramBot, chatId: TelegramBot.ChatId) {
    const keyboard: TelegramBot.SendMessageOptions = {
        reply_markup: {
            keyboard: [
                [{ text: 'Заново' }, { text: 'Скачать ноты' }]
            ],
            is_persistent: true,
            resize_keyboard: true,
        },
    };
    bot.sendMessage(chatId, "Привет! Что я могу сделать?", keyboard);
}

// Главное меню с кнопкой "Скачать ноты"
bot.onText(/\/start/, (msg) => {
    start(bot, msg.chat.id);
});

// Обработка кнопки "Скачать ноты"
bot.on("message", async (msg) => {
    console.log("message:",JSON.stringify(msg, null, 2));

    const chatId = msg.chat.id;
    if (msg.text === "Заново") {
        start(bot, chatId);
    } else if (msg.text === "Скачать ноты") {
        try {
            const files = fs.readdirSync(FILES_DIR).filter(file => file.endsWith(".pdf"));

            if (files.length === 0) {
                return bot.sendMessage(chatId, "Нет доступных файлов.");
            }

            // Формируем inline-кнопки со списком файлов
            const fileButtons = files.map((file) => [
                { text: file, callback_data: `get_${file}` }
            ]);

            bot.sendMessage(chatId, "Выберите файл для скачивания:", {
                reply_markup: { inline_keyboard: fileButtons },
            });

        } catch (error) {
            console.error("Ошибка чтения файлов:", error);
            bot.sendMessage(chatId, "Произошла ошибка при загрузке списка файлов.");
        }
    }
    return;
});

// Обработка выбора файла
bot.on("callback_query", (query) => {
    console.log("callback_query:", JSON.stringify(query, null, 2));


    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const fileName = query.data?.replace("get_", "");
    if (!fileName) return;

    const filePath = path.join(FILES_DIR, fileName);

    bot.sendDocument(chatId, fs.createReadStream(filePath), {
        caption: `Ваш файл: ${fileName}`,
    }).catch((err) => {
        console.error("Ошибка отправки файла:", err);
        bot.sendMessage(chatId, "Не удалось отправить файл.");
    });
});

console.log("Бот запущен...");
