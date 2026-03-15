import asyncio
import logging
import random
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ForceReply
from telegram.constants import ParseMode
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, ContextTypes, filters

# Import từ app của bạn
from app.config import *               # BOT_TOKEN, ADMIN_ID, TOKEN_SETS, NUM_WORKERS, T(), E_*, NEXTDNS_API_KEY
from app import database as db
from app.services import locket, nextdns

logger = logging.getLogger(__name__)

request_queue = asyncio.Queue()
pending_items = []
queue_lock = asyncio.Lock()

class Clr:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

DENY_MSG = "⛔ Bạn không có quyền truy cập hệ thống."

async def update_pending_positions(app):
    for i, item in enumerate(pending_items):
        position = i + 1
        ahead = i
        try:
            await app.bot.edit_message_text(
                chat_id=item['chat_id'],
                message_id=item['message_id'],
                text=T("queued").format(item['username'], position, ahead),
                parse_mode=ParseMode.HTML
            )
            if ahead == 2:
                try:
                    await app.bot.send_message(
                        chat_id=item['chat_id'],
                        text=T("queue_almost"),
                        parse_mode=ParseMode.HTML
                    )
                except:
                    pass
        except:
            pass

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_ID:
        await update.message.reply_text(DENY_MSG, parse_mode=ParseMode.HTML)
        return

    await update.message.reply_text(
        T("welcome"),
        parse_mode=ParseMode.HTML,
        reply_markup=get_main_menu_keyboard()
    )

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_ID:
        return  # im lặng hoàn toàn với người lạ

    if not update.message.reply_to_message or not update.message.reply_to_message.from_user.is_bot:
        return

    text = update.message.text.strip()
    if "locket.cam/" in text:
        username = text.split("locket.cam/")[-1].split("?")[0]
    elif len(text) < 50 and " " not in text:
        username = text
    else:
        username = text

    msg = await update.message.reply_text(T("resolving"), parse_mode=ParseMode.HTML)

    uid = await locket.resolve_uid(username)
    if not uid:
        await msg.edit_text(T("not_found"), parse_mode=ParseMode.HTML)
        return

    if not db.check_can_request(user_id):
        await msg.edit_text(T("limit_reached"), parse_mode=ParseMode.HTML)
        return

    await msg.edit_text(T("checking_status"), parse_mode=ParseMode.HTML)
    status = await locket.check_status(uid)

    status_text = T("free_status")
    if status and status.get("active"):
        status_text = T("gold_active").format(status['expires'])

    safe_username = username[:30]
    keyboard = [[InlineKeyboardButton(T("btn_upgrade"), callback_data=f"upg|{uid}|{safe_username}")]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await msg.edit_text(
        f"{T('user_info_title')}\n"
        f"{E_ID}: <code>{uid}</code>\n"
        f"{E_TAG}: <code>{username}</code>\n"
        f"{E_STAT} <b>Trạng thái</b>: {status_text}\n\n"
        f"👇",
        parse_mode=ParseMode.HTML,
        reply_markup=reply_markup
    )

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id

    if user_id != ADMIN_ID:
        try:
            await query.answer(DENY_MSG, show_alert=True)
        except:
            pass
        return

    data = query.data
    if data == "menu_input":
        try:
            await query.answer()
        except:
            pass
        await query.message.reply_text(
            T("prompt_input"),
            parse_mode=ParseMode.HTML,
            reply_markup=ForceReply(selective=True, input_field_placeholder="Username...")
        )
        return

    if data.startswith("upg|"):
        parts = data.split("|")
        uid = parts[1]
        username = parts[2] if len(parts) > 2 else uid

        try:
            await query.answer("🚀 Đang xếp hàng...")
        except:
            pass

        item = {
            'user_id': user_id,
            'uid': uid,
            'username': username,
            'chat_id': query.message.chat_id,
            'message_id': query.message.message_id,
        }

        async with queue_lock:
            pending_items.append(item)
            position = len(pending_items)
            ahead = position - 1

        await query.edit_message_text(
            T("queued").format(username, position, ahead),
            parse_mode=ParseMode.HTML
        )

        await request_queue.put(item)

async def queue_worker(app, worker_id):
    token_idx = (worker_id - 1) % len(TOKEN_SETS)
    token_config = TOKEN_SETS[token_idx]
    token_name = f"Token-{token_idx+1}"

    print(f"Worker #{worker_id} started using {token_name}...")

    while True:
        try:
            item = await request_queue.get()

            user_id = item['user_id']
            uid = item['uid']
            username = item['username']
            chat_id = item['chat_id']
            message_id = item['message_id']

            async with queue_lock:
                if item in pending_items:
                    pending_items.remove(item)
                await update_pending_positions(app)

            print(f"{Clr.BLUE}[Worker #{worker_id}][{token_name}] Processing:{Clr.ENDC} UID={uid} | UserID={user_id}")

            async def edit(text):
                try:
                    await app.bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text=text,
                        parse_mode=ParseMode.HTML,
                        disable_web_page_preview=True
                    )
                except Exception as e:
                    if "Message is not modified" in str(e) or "Message to edit not found" in str(e):
                        pass
                    else:
                        logger.error(f"Edit msg error: {e}")

            logs = [f"[Worker #{worker_id}] Processing Request..."]
            loop = asyncio.get_running_loop()

            def safe_log_callback(msg):
                clean_msg = msg.replace(Clr.BLUE,"").replace(Clr.GREEN,"").replace(Clr.WARNING,"").replace(Clr.FAIL,"").replace(Clr.ENDC,"").replace(Clr.BOLD,"")
                logs.append(clean_msg)
                asyncio.run_coroutine_threadsafe(update_log_ui(), loop)

            async def update_log_ui():
                display_logs = "\n".join(logs[-10:])
                text = f"{E_LOADING} <b>⚡ ĐANG THỰC HIỆN...</b>\n<pre>{display_logs}</pre>"
                try:
                    await app.bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text=text,
                        parse_mode=ParseMode.HTML,
                        disable_web_page_preview=True
                    )
                except:
                    pass

            await update_log_ui()

            success, msg_result = await locket.inject_gold(uid, token_config, safe_log_callback)

            db.log_request(user_id, uid, "SUCCESS" if success else "FAIL")

            if success:
                # ANTI-REVOKE: Luôn chạy cho mọi success
                try:
                    print(f"{Clr.WARNING}[DEBUG] Bắt đầu NextDNS cho UID {uid} ({username}){Clr.ENDC}")
                    profile_id, config_link = await nextdns.create_or_get_daily_profile(NEXTDNS_API_KEY)
                    if profile_id:
                        print(f"{Clr.GREEN}[Anti-Revoke] SUCCESS! Profile ID: {profile_id} | Link: {config_link} | UID {uid} ({username}){Clr.ENDC}")
                        await app.bot.send_message(
                            chat_id=chat_id,
                            text=f"✅ Anti-Revoke NextDNS active cho {username}\nProfile: {profile_id}\nLink: {config_link}"
                        )
                    else:
                        print(f"{Clr.FAIL}[NextDNS] Không tạo/get được profile (check log nextdns.py){Clr.ENDC}")
                        await app.bot.send_message(
                            chat_id=chat_id,
                            text=f"⚠️ NextDNS fail cho {username} - check console / nextdns.py"
                        )
                except Exception as e:
                    print(f"{Clr.FAIL}[NextDNS Error] {str(e)}{Clr.ENDC}")
                    logger.error(f"NextDNS error: {e}")
                    await app.bot.send_message(
                        chat_id=chat_id,
                        text=f"❌ NextDNS lỗi: {str(e)[:100]} - check key/payload trong config.py"
                    )

                final_msg = (
                    f"✅ <b>THÀNH CÔNG</b>\n\n"
                    f"ID/Username: <code>{username}</code>\n"
                    f"Trạng thái: <b>Thành công</b>"
                )

                try:
                    await app.bot.delete_message(chat_id=chat_id, message_id=message_id)
                except:
                    pass

                await app.bot.send_message(
                    chat_id=chat_id,
                    text=final_msg,
                    parse_mode=ParseMode.HTML
                )

                # Bỏ renew vì Gold bền nhờ NextDNS
                # Nếu muốn refresh phòng hờ: uncomment
                # await asyncio.sleep(random.randint(3600, 7200))

            else:
                final_msg = (
                    f"❌ <b>THẤT BẠI</b>\n\n"
                    f"ID/Username: <code>{username}</code>\n"
                    f"Trạng thái: <b>Thất bại</b>\n"
                    f"Lý do: <code>{msg_result[:100]}</code>"
                )
                await edit(final_msg)

            request_queue.task_done()

        except Exception as e:
            logger.error(f"Worker #{worker_id} Exception: {e}")
            request_queue.task_done()

def get_main_menu_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(T("btn_input"), callback_data="menu_input")],
    ])

def run_bot():
    logging.basicConfig(
        format='%(message)s',
        level=logging.INFO
    )
    logging.getLogger("httpx").setLevel(logging.ERROR)
    logging.getLogger("telegram").setLevel(logging.ERROR)
    logging.getLogger("aiohttp").setLevel(logging.ERROR)

    app = ApplicationBuilder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    async def post_init(application):
        for i in range(1, NUM_WORKERS + 1):
            asyncio.create_task(queue_worker(application, i))

    app.post_init = post_init
    print(f"Bot đang chạy... ({NUM_WORKERS} workers) - Chỉ admin ({ADMIN_ID}) được sử dụng")
    app.run_polling()

if __name__ == "__main__":
    run_bot()