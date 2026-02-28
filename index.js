import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:3000'
const ADMIN_TOKEN = process.env.GATEWAY_ADMIN_TOKEN || 'supersecret'

// URL сайта MakeMeet (для кнопки "Открыть в MakeMeet")
const MAKEMEET_WEB_BASE = (process.env.MAKEMEET_WEB_BASE || '').replace(
  /\/$/,
  ''
)

// ===== UI: нижняя клавиатура (русская) =====
const keyboard = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 Общая статистика' }],
      [{ text: '🆕 Последние посты' }, { text: '👥 Новые пользователи' }],
      [{ text: '🔥 Активные спринты' }]
    ],
    resize_keyboard: true
  }
}

// ===== helpers =====
function truncate(text, max = 42) {
  if (!text) return ''
  const clean = String(text).trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('ru-RU')
}

async function fetchOverview() {
  const res = await axios.get(`${GATEWAY_URL}/admin/overview`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    timeout: 8000,
    proxy: false
  })
  return res.data
}

function openMakeMeetButtons(type, items) {
  // type: "posts" | "users" | "sprints"
  if (!MAKEMEET_WEB_BASE) return null
  if (!Array.isArray(items) || items.length === 0) return null

  // делаем до 5 кнопок (Telegram ограничивает клавиатуру по ширине)
  const buttons = items
    .slice(0, 5)
    .map((item, idx) => {
      const id = item?.id
      if (!id) return null

      let url = MAKEMEET_WEB_BASE
      if (type === 'posts') url = `${MAKEMEET_WEB_BASE}/admin/posts/${id}/edit`
      if (type === 'users') url = `${MAKEMEET_WEB_BASE}/admin/users/${id}/edit`
      if (type === 'sprints')
        url = `${MAKEMEET_WEB_BASE}/admin/sprints/${id}/edit`

      const label = `Открыть #${idx + 1}`
      return [{ text: label, url }]
    })
    .filter(Boolean)

  if (buttons.length === 0) return null

  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  }
}

// ===== handlers =====
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id

  const lines = [
    '🤖 *MakeMeet — Админ-бот*',
    '',
    'Нажимай кнопки снизу — я возьму данные через API Gateway.',
    '',
    MAKEMEET_WEB_BASE
      ? `🌐 Ссылка на MakeMeet включена: \`${MAKEMEET_WEB_BASE}\``
      : '🌐 Ссылка на MakeMeet не задана (кнопка «Открыть» будет скрыта).'
  ]

  await bot.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...keyboard
  })
})

bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  if (!text) return
  if (text === '/start') return // уже обработали

  // игнорируем случайные сообщения
  const allowed = new Set([
    '📊 Общая статистика',
    '🆕 Последние посты',
    '👥 Новые пользователи',
    '🔥 Активные спринты'
  ])
  if (!allowed.has(text)) return

  try {
    await bot.sendMessage(chatId, '⏳ Загружаю…', keyboard)

    const data = await fetchOverview()

    // ===== Общая статистика =====
    if (text === '📊 Общая статистика') {
      const c = data.counts || {}
      const message = [
        '📊 *Общая статистика MakeMeet*',
        '',
        `👥 Пользователи: *${c.users ?? '-'}*`,
        `📝 Посты: *${c.posts ?? '-'}*`,
        `💬 Комментарии: *${c.comments ?? '-'}*`,
        `❤️ Лайки: *${c.likes ?? '-'}*`,
        `🏁 Спринты: *${c.sprints ?? '-'}*`,
        `👥 Участники: *${c.participants ?? '-'}*`
      ].join('\n')

      return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
    }

    // ===== Последние посты =====
    if (text === '🆕 Последние посты') {
      const postsArr = (data.latest_posts || []).slice(0, 5)

      const postsText = postsArr
        .map((p, i) => {
          const title = truncate(p.title, 52)
          const author = p.author ? `👤 ${truncate(p.author, 18)}` : '👤 —'
          const date = `📅 ${fmtDate(p.created_at)}`
          return `${i + 1}. 📝 *${title}*\n   ${author} | ${date}`
        })
        .join('\n\n')

      const message = `🆕 *Последние посты:*\n\n${postsText || 'Нет данных'}`

      const buttons = openMakeMeetButtons('posts', postsArr)

      return bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...(buttons || {})
      })
    }

    // ===== Новые пользователи =====
    if (text === '👥 Новые пользователи') {
      const usersArr = (data.latest_users || []).slice(0, 5)

      const usersText = usersArr
        .map((u, i) => {
          const username = truncate(u.username, 24)
          const email = u.email ? truncate(u.email, 32) : '-'
          const date = fmtDate(u.created_at)
          return `${i + 1}. 👤 *${username}*\n   ✉️ ${email} | 📅 ${date}`
        })
        .join('\n\n')

      const message = `👥 *Новые пользователи:*\n\n${usersText || 'Нет данных'}`
      const buttons = openMakeMeetButtons('users', usersArr)

      return bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...(buttons || {})
      })
    }

    // ===== Активные спринты =====
    if (text === '🔥 Активные спринты') {
      const sprintsArr = (data.active_sprints || []).slice(0, 5)

      const sprintsText = sprintsArr
        .map((s, i) => {
          const title = truncate(s.title, 52)
          const status = s.status ? truncate(s.status, 14) : '-'
          const ppl = s.participants_count ?? '-'
          const ends = s.ends_at ? fmtDate(s.ends_at) : '-'
          return `${i + 1}. 🔥 *${title}*\n   🏷️ ${status} | 👥 ${ppl} | ⏳ до ${ends}`
        })
        .join('\n\n')

      const message = `🔥 *Активные спринты:*\n\n${sprintsText || 'Нет данных'}`
      const buttons = openMakeMeetButtons('sprints', sprintsArr)

      return bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...(buttons || {})
      })
    }
  } catch (e) {
    return bot.sendMessage(
      chatId,
      `❌ Ошибка API: ${e?.message || e}`,
      keyboard
    )
  }
})

console.log('Бот запущен ✅')
