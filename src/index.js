import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose, { Schema, model, Types } from 'mongoose'
import jwt from 'jsonwebtoken'

const app = express()

// ====== ENV ======
const PORT = process.env.PORT || 8080
const JWT_SECRET = process.env.JWT_SECRET || 'change-me'
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const MONGODB_URI = process.env.MONGODB_URI // Debe incluir la DB (sample_mflix o moviesdb)
const COLLECTION = process.env.COLLECTION || 'movies'

// ====== MIDDLEWARES ======
app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json())

// ====== AUTH (requiere el MISMO JWT_SECRET que tu auth-service) ======
function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
}

// ====== DB y MODELO flexible (acepta cualquier forma de movie) ======
const MovieSchema = new Schema({}, { strict: false, collection: COLLECTION })
const Movie = model('Movie', MovieSchema)

// ====== HEALTH ======
app.get('/health', (_, res) => {
  const ok = mongoose.connection.readyState === 1
  res.status(ok ? 200 : 503).json({ ok })
})

// ====== RUTAS PROTEGIDAS ======
// GET /movies?limit=20&page=1&q=term&year=2010&genres=Action,Drama
app.get('/movies', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100)
    const page = Math.max(parseInt(req.query.page || '1', 10), 1)
    const skip = (page - 1) * limit
    const q = (req.query.q || '').trim()
    const year = req.query.year ? parseInt(req.query.year, 10) : null
    const genres = (req.query.genres || '').split(',').map(s => s.trim()).filter(Boolean)

    const filter = {}
    if (q) filter.title = { $regex: q, $options: 'i' }
    if (!Number.isNaN(year) && year) filter.year = year
    if (genres.length) filter.genres = { $in: genres }

    const [items, total] = await Promise.all([
      Movie.find(filter).skip(skip).limit(limit).lean(),
      Movie.countDocuments(filter)
    ])

    res.json({ total, page, limit, items })
  } catch (e) {
    res.status(500).json({ error: 'Error al listar movies' })
  }
})

app.get('/movies/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'id inválido' })
    const doc = await Movie.findById(id).lean()
    if (!doc) return res.status(404).json({ error: 'No encontrado' })
    res.json(doc)
  } catch {
    res.status(500).json({ error: 'Error al obtener movie' })
  }
})

// ====== ARRANQUE: escuchar primero y conectar con reintentos ======
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Movies API escuchando en :${PORT}`)
})

async function connectWithRetry() {
  if (!MONGODB_URI) { console.error('❌ MONGODB_URI no definido'); return }
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    console.log('✅ Conectado a MongoDB (movies)')
  } catch (e) {
    console.error('⚠️ MongoDB error:', e.message, '— reintento en 5s...')
    setTimeout(connectWithRetry, 5000)
  }
}
connectWithRetry()
