import { useEffect, useMemo, useState } from 'react'
import Calendar from 'react-calendar'
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import 'react-calendar/dist/Calendar.css'
import { db, firebaseEnabled } from './firebase'

const STRATEGIES = ['Self', 'Vinbull', 'Stock Learners']

const STRATEGY_RULES = {
  Self: { maxTradesPerDay: 3, maxLotSize: 2, maxLossPerTrade: 5 },
  Vinbull: { maxTradesPerDay: 2, maxLotSize: 1, maxLossPerTrade: 15 },
  'Stock Learners': { maxTradesPerDay: 3, maxLotSize: 4, maxLossPerTrade: 6 },
}

const STRATEGY_COLORS = {
  Self: '#22c55e',
  Vinbull: '#3b9eff',
  'Stock Learners': '#a78bfa',
}

const CHART = {
  grid: 'rgba(255,255,255,0.06)',
  axis: '#5c6d82',
  profit: '#22c55e',
  loss: '#ef4444',
  accent: '#3b9eff',
  tooltip: {
    background: '#161d28',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#f0f4f8',
    fontSize: 13,
  },
}

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'trade', label: 'Log Trade' },
  { id: 'learnings', label: 'Learnings' },
]

function IconChart() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12 L6 8 L9 10 L14 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2" strokeLinecap="round" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2.5h4a2 2 0 0 1 2 2V13.5a2 2 0 0 0-2-2H3zM13 2.5H9a2 2 0 0 0-2 2V13.5a2 2 0 0 1 2-2h4z" />
    </svg>
  )
}

const TAB_ICONS = {
  dashboard: IconChart,
  calendar: IconCalendar,
  trade: IconPlus,
  learnings: IconBook,
}

function toDateKey(dateInput) {
  const date = new Date(dateInput)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTodayDateKey() {
  return toDateKey(new Date())
}

function getDefaultTradeForm(date = getTodayDateKey(), strategy = 'Self') {
  return {
    date,
    strategy,
    lotSize: STRATEGY_RULES[strategy].maxLotSize,
    pointsCaptured: '',
    pnl: '',
  }
}

const DEFAULT_LEARNING_FORM = {
  date: getTodayDateKey(),
  note: '',
}

function normalizeTrade(trade) {
  let strategy = trade.strategy
  if (!strategy || !STRATEGY_RULES[strategy]) {
    strategy = 'Self'
  }

  return {
    ...trade,
    strategy,
    lotSize: Number(trade.lotSize ?? STRATEGY_RULES[strategy].maxLotSize),
    pnl: Number(trade.pnl ?? 0),
    pointsCaptured: trade.pointsCaptured ?? '',
  }
}

function normalizeTrades(tradeList) {
  return tradeList.map(normalizeTrade)
}

function getTradeStrategy(trade) {
  return normalizeTrade(trade).strategy
}

function evaluateDayRules(dayTrades) {
  if (!dayTrades.length) {
    return { followed: null, reasons: [] }
  }

  const reasons = []

  STRATEGIES.forEach((strategy) => {
    const rules = STRATEGY_RULES[strategy]
    const strategyTrades = dayTrades.filter((trade) => getTradeStrategy(trade) === strategy)

    if (strategyTrades.length > rules.maxTradesPerDay) {
      reasons.push(
        `${strategy}: more than ${rules.maxTradesPerDay} trades (${strategyTrades.length} taken)`,
      )
    }

    strategyTrades.forEach((trade) => {
      const lotSize = Number(trade.lotSize)
      if (lotSize > rules.maxLotSize) {
        reasons.push(
          `${strategy}: quantity exceeds max ${rules.maxLotSize} lots (took ${lotSize})`,
        )
      }

      const pnl = Number(trade.pnl)
      if (pnl < 0 && Math.abs(pnl) > rules.maxLossPerTrade) {
        reasons.push(
          `${strategy}: loss exceeded $${rules.maxLossPerTrade} (lost $${Math.abs(pnl).toFixed(2)})`,
        )
      }
    })
  })

  return {
    followed: reasons.length === 0,
    reasons,
  }
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function readLocalTrades() {
  try {
    const localData = localStorage.getItem('trade-journal-trades')
    if (!localData) {
      return []
    }

    const parsedTrades = JSON.parse(localData)
    return Array.isArray(parsedTrades) ? normalizeTrades(parsedTrades) : []
  } catch {
    return []
  }
}

function readLocalLearnings() {
  try {
    const localData = localStorage.getItem('trade-journal-learnings')
    if (!localData) {
      return []
    }

    const parsedLearnings = JSON.parse(localData)
    return Array.isArray(parsedLearnings) ? parsedLearnings : []
  } catch {
    return []
  }
}

function App() {
  const [trades, setTrades] = useState(() => (firebaseEnabled ? [] : readLocalTrades()))
  const [learnings, setLearnings] = useState(() => (firebaseEnabled ? [] : readLocalLearnings()))
  const [form, setForm] = useState(() => getDefaultTradeForm())
  const [learningForm, setLearningForm] = useState(DEFAULT_LEARNING_FORM)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingLearning, setIsSavingLearning] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')

  useEffect(() => {
    if (firebaseEnabled) {
      const tradesRef = collection(db, 'trades')
      const tradesQuery = query(tradesRef, orderBy('date', 'desc'), orderBy('createdAt', 'desc'))

      const unsubscribe = onSnapshot(
        tradesQuery,
        (snapshot) => {
          const nextTrades = normalizeTrades(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
          setTrades(nextTrades)
        },
        (e) => {
          setErrorMessage('Unable to read trades from Firebase.')
          console.log(e)
        },
      )

      return () => unsubscribe()
    }

    return undefined
  }, [])

  useEffect(() => {
    if (!firebaseEnabled) {
      localStorage.setItem('trade-journal-trades', JSON.stringify(trades))
    }
  }, [trades])

  useEffect(() => {
    if (activeTab === 'trade') {
      setForm((prev) => ({ ...prev, date: selectedDateKey }))
    }
  }, [activeTab])

  useEffect(() => {
    if (firebaseEnabled) {
      const learningsRef = collection(db, 'learnings')
      const learningsQuery = query(learningsRef, orderBy('date', 'desc'))

      const unsubscribe = onSnapshot(
        learningsQuery,
        (snapshot) => {
          const nextLearnings = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          setLearnings(nextLearnings)
        },
        (e) => {
          setErrorMessage('Unable to read learning notes from Firebase.')
          console.log(e)
        },
      )

      return () => unsubscribe()
    }

    return undefined
  }, [])

  useEffect(() => {
    if (!firebaseEnabled) {
      localStorage.setItem('trade-journal-learnings', JSON.stringify(learnings))
    }
  }, [learnings])

  const tradesByDate = useMemo(() => {
    return trades.reduce((acc, trade) => {
      const key = trade.date
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(trade)
      return acc
    }, {})
  }, [trades])

  const dayEvaluationMap = useMemo(() => {
    const map = {}
    Object.keys(tradesByDate).forEach((day) => {
      map[day] = evaluateDayRules(tradesByDate[day])
    })
    return map
  }, [tradesByDate])

  const selectedDateKey = toDateKey(selectedDate)
  const selectedDateTrades = tradesByDate[selectedDateKey] || []
  const selectedDateEvaluation = evaluateDayRules(selectedDateTrades)

  const totalPnl = useMemo(() => {
    return trades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
  }, [trades])

  const totalTrades = trades.length
  const winningTrades = useMemo(() => trades.filter((trade) => Number(trade.pnl) > 0).length, [trades])
  const losingTrades = useMemo(() => trades.filter((trade) => Number(trade.pnl) < 0).length, [trades])
  const winRate = totalTrades ? (winningTrades / totalTrades) * 100 : 0
  const averageTradePnl = totalTrades ? totalPnl / totalTrades : 0
  const averageWinningTradePnl = useMemo(() => {
    const wins = trades.filter((trade) => Number(trade.pnl) > 0)
    if (!wins.length) {
      return 0
    }

    const winsTotal = wins.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
    return winsTotal / wins.length
  }, [trades])

  const averageLosingTradePnl = useMemo(() => {
    const losses = trades.filter((trade) => Number(trade.pnl) < 0)
    if (!losses.length) {
      return 0
    }

    const lossesTotal = losses.reduce((sum, trade) => sum + Math.abs(Number(trade.pnl || 0)), 0)
    return lossesTotal / losses.length
  }, [trades])

  const rrRatio = useMemo(() => {
    if (!averageWinningTradePnl || !averageLosingTradePnl) {
      return null
    }

    return averageWinningTradePnl / averageLosingTradePnl
  }, [averageWinningTradePnl, averageLosingTradePnl])

  const averagePoints = useMemo(() => {
    if (!totalTrades) {
      return 0
    }
    const pointsTotal = trades.reduce((sum, trade) => sum + Number(trade.pointsCaptured || 0), 0)
    return pointsTotal / totalTrades
  }, [trades, totalTrades])

  const setupPnlData = useMemo(() => {
    const strategyMap = {}
    STRATEGIES.forEach((strategy) => {
      strategyMap[strategy] = 0
    })

    trades.forEach((trade) => {
      const strategy = getTradeStrategy(trade)
      strategyMap[strategy] = (strategyMap[strategy] || 0) + Number(trade.pnl || 0)
    })

    return Object.entries(strategyMap).map(([strategy, pnl]) => ({
      strategy,
      pnl,
      fill: pnl >= 0 ? CHART.profit : CHART.loss,
    }))
  }, [trades])

  const ruleStats = useMemo(() => {
    const days = Object.keys(dayEvaluationMap)
    const followed = days.filter((day) => dayEvaluationMap[day].followed === true).length
    const notFollowed = days.filter((day) => dayEvaluationMap[day].followed === false).length
    return { followed, notFollowed }
  }, [dayEvaluationMap])

  const dailyPnlData = useMemo(() => {
    return Object.entries(tradesByDate)
      .map(([date, dayTrades]) => ({
        date,
        pnl: dayTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [tradesByDate])

  const accountGrowthData = useMemo(() => {
    let runningTotal = 0

    return dailyPnlData.map((day) => {
      runningTotal += Number(day.pnl || 0)
      return {
        date: day.date,
        equity: runningTotal,
      }
    })
  }, [dailyPnlData])

  const strategyDistribution = useMemo(() => {
    const strategyMap = {}
    STRATEGIES.forEach((strategy) => {
      strategyMap[strategy] = 0
    })

    trades.forEach((trade) => {
      const strategy = getTradeStrategy(trade)
      strategyMap[strategy] = (strategyMap[strategy] || 0) + 1
    })

    return Object.entries(strategyMap).map(([name, value]) => ({
      name,
      value,
    }))
  }, [trades])

  const strategyPnlBreakdown = useMemo(() => {
    return STRATEGIES.map((strategy) => {
      const strategyTrades = trades.filter((trade) => getTradeStrategy(trade) === strategy)
      const totalPnl = strategyTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
      return {
        strategy,
        trades: strategyTrades.length,
        totalPnl,
      }
    })
  }, [trades])

  const bestAndWorstDay = useMemo(() => {
    if (!dailyPnlData.length) {
      return {
        bestDay: null,
        worstDay: null,
      }
    }

    const bestDay = dailyPnlData.reduce((best, current) => {
      return current.pnl > best.pnl ? current : best
    }, dailyPnlData[0])

    const worstDay = dailyPnlData.reduce((worst, current) => {
      return current.pnl < worst.pnl ? current : worst
    }, dailyPnlData[0])

    return { bestDay, worstDay }
  }, [dailyPnlData])

  const streakData = useMemo(() => {
    if (!dailyPnlData.length) {
      return {
        currentWinStreak: 0,
        longestWinStreak: 0,
        currentLossStreak: 0,
        longestLossStreak: 0,
        maxConsecutiveLosingDays: 0,
      }
    }

    let currentStreak = 0
    let currentStreakType = null
    let longestWinStreak = 0
    let longestLossStreak = 0
    let maxConsecutiveLosingDays = 0
    let currentLossingDays = 0

    dailyPnlData.forEach((day) => {
      const isWin = day.pnl > 0
      const isLoss = day.pnl < 0

      if (isWin) {
        currentLossingDays = 0
        if (currentStreakType === 'win') {
          currentStreak += 1
        } else {
          if (currentStreakType === 'loss') {
            longestLossStreak = Math.max(longestLossStreak, currentStreak)
          }
          currentStreak = 1
          currentStreakType = 'win'
        }
      } else if (isLoss) {
        currentLossingDays += 1
        maxConsecutiveLosingDays = Math.max(maxConsecutiveLosingDays, currentLossingDays)
        if (currentStreakType === 'loss') {
          currentStreak += 1
        } else {
          if (currentStreakType === 'win') {
            longestWinStreak = Math.max(longestWinStreak, currentStreak)
          }
          currentStreak = 1
          currentStreakType = 'loss'
        }
      }
    })

    if (currentStreakType === 'win') {
      longestWinStreak = Math.max(longestWinStreak, currentStreak)
    } else if (currentStreakType === 'loss') {
      longestLossStreak = Math.max(longestLossStreak, currentStreak)
    }

    return {
      currentWinStreak: currentStreakType === 'win' ? currentStreak : 0,
      longestWinStreak,
      currentLossStreak: currentStreakType === 'loss' ? currentStreak : 0,
      longestLossStreak,
      maxConsecutiveLosingDays,
    }
  }, [dailyPnlData])

  const profitFactor = useMemo(() => {
    const totalWins = trades
      .filter((trade) => Number(trade.pnl) > 0)
      .reduce((sum, trade) => sum + Number(trade.pnl), 0)

    const totalLosses = Math.abs(
      trades
        .filter((trade) => Number(trade.pnl) < 0)
        .reduce((sum, trade) => sum + Number(trade.pnl), 0),
    )

    if (totalLosses === 0) {
      return totalWins > 0 ? 'Infinite' : '-'
    }

    return (totalWins / totalLosses).toFixed(2)
  }, [trades])

  const strategyPerformance = useMemo(() => {
    const strategyMap = {}
    STRATEGIES.forEach((strategy) => {
      strategyMap[strategy] = {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
    })

    trades.forEach((trade) => {
      const strategy = getTradeStrategy(trade)
      const stats = strategyMap[strategy] || {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
      stats.trades += 1
      stats.totalPnl += Number(trade.pnl || 0)
      if (Number(trade.pnl) > 0) {
        stats.wins += 1
      } else if (Number(trade.pnl) < 0) {
        stats.losses += 1
      }
      stats.winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0
      strategyMap[strategy] = stats
    })

    return Object.entries(strategyMap)
      .map(([strategy, data]) => ({
        strategy,
        ...data,
      }))
      .filter((item) => item.trades > 0)
  }, [trades])

  const monthlyPerformance = useMemo(() => {
    const monthMap = {}

    trades.forEach((trade) => {
      const date = new Date(trade.date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          month: monthKey,
          pnl: 0,
          trades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          tradingDays: new Set(),
        }
      }

      monthMap[monthKey].trades += 1
      monthMap[monthKey].pnl += Number(trade.pnl || 0)
      monthMap[monthKey].tradingDays.add(trade.date)
      if (Number(trade.pnl) > 0) {
        monthMap[monthKey].wins += 1
      } else if (Number(trade.pnl) < 0) {
        monthMap[monthKey].losses += 1
      }
      monthMap[monthKey].winRate = (monthMap[monthKey].wins / monthMap[monthKey].trades) * 100
    })

    return Object.values(monthMap)
      .map((month) => ({
        ...month,
        tradingDays: month.tradingDays.size,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [trades])

  const profitableVsUnprofitableDays = useMemo(() => {
    let profitableDays = 0
    let unprofitableDays = 0
    let breakEvenDays = 0

    dailyPnlData.forEach((day) => {
      if (day.pnl > 0) {
        profitableDays += 1
      } else if (day.pnl < 0) {
        unprofitableDays += 1
      } else {
        breakEvenDays += 1
      }
    })

    return { profitableDays, unprofitableDays, breakEvenDays }
  }, [dailyPnlData])

  const learningTableData = useMemo(() => {
    return [...learnings].sort((a, b) => b.date.localeCompare(a.date))
  }, [learnings])

  function handleFieldChange(event) {
    const { name, value } = event.target

    if (name === 'strategy') {
      setForm((prev) => ({
        ...prev,
        strategy: value,
        lotSize: STRATEGY_RULES[value].maxLotSize,
      }))
      return
    }

    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function setTradeDate(dateKey) {
    setForm((prev) => ({ ...prev, date: dateKey }))
  }

  function setTradeDateToToday() {
    setTradeDate(getTodayDateKey())
  }

  function setTradeDateToYesterday() {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    setTradeDate(toDateKey(yesterday))
  }

  async function handleAddTrade(event) {
    event.preventDefault()
    setErrorMessage('')

    const tradeToSave = {
      date: form.date,
      strategy: form.strategy,
      lotSize: Number(form.lotSize),
      pointsCaptured: form.pointsCaptured === '' ? '' : Number(form.pointsCaptured),
      pnl: Number(form.pnl),
      createdAt: new Date().toISOString(),
    }

    if (tradeToSave.pointsCaptured !== '' && Number.isNaN(tradeToSave.pointsCaptured)) {
      setErrorMessage('Points must be a valid number.')
      return
    }

    if (Number.isNaN(tradeToSave.pnl)) {
      setErrorMessage('P&L must be a valid number.')
      return
    }

    try {
      setIsSaving(true)
      if (firebaseEnabled) {
        await addDoc(collection(db, 'trades'), {
          ...tradeToSave,
          createdAt: serverTimestamp(),
        })
      } else {
        setTrades((prev) => [
          {
            id: crypto.randomUUID(),
            ...tradeToSave,
          },
          ...prev,
        ])
      }

      setForm(getDefaultTradeForm(form.date, form.strategy))
      setSelectedDate(new Date(form.date + 'T12:00:00'))
      setActiveTab('calendar')
    } catch {
      setErrorMessage('Trade could not be saved. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleLearningFieldChange(event) {
    const { name, value } = event.target
    setLearningForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleAddLearning(event) {
    event.preventDefault()
    setErrorMessage('')

    const trimmedNote = learningForm.note.trim()
    if (!trimmedNote) {
      setErrorMessage('Learning note cannot be empty.')
      return
    }

    const learningToSave = {
      date: learningForm.date,
      note: trimmedNote,
      createdAt: new Date().toISOString(),
    }

    try {
      setIsSavingLearning(true)
      if (firebaseEnabled) {
        await addDoc(collection(db, 'learnings'), {
          ...learningToSave,
          createdAt: serverTimestamp(),
        })
      } else {
        setLearnings((prev) => [
          {
            id: crypto.randomUUID(),
            ...learningToSave,
          },
          ...prev,
        ])
      }

      setLearningForm((prev) => ({ ...prev, note: '' }))
    } catch {
      setErrorMessage('Learning note could not be saved. Please try again.')
    } finally {
      setIsSavingLearning(false)
    }
  }

  function handleCalendarChange(value) {
    if (Array.isArray(value)) {
      setSelectedDate(value[0])
      return
    }

    setSelectedDate(value)
  }

  function getDayPnl(dayTrades) {
    return dayTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
  }

  function rulesTileClassName({ date, view }) {
    if (view !== 'month') {
      return null
    }

    const key = toDateKey(date)
    if (!dayEvaluationMap[key]) {
      return null
    }

    return dayEvaluationMap[key].followed ? 'tile-followed' : 'tile-broken'
  }

  function pnlTileClassName({ date, view }) {
    if (view !== 'month') {
      return null
    }

    const key = toDateKey(date)
    const dayTrades = tradesByDate[key]
    if (!dayTrades?.length) {
      return null
    }

    const dayPnl = getDayPnl(dayTrades)
    if (dayPnl > 0) {
      return 'tile-profitable'
    }
    if (dayPnl < 0) {
      return 'tile-unprofitable'
    }
    return 'tile-breakeven'
  }

  function pnlTileContent({ date, view }) {
    if (view !== 'month') {
      return null
    }

    const key = toDateKey(date)
    const dayTrades = tradesByDate[key]
    if (!dayTrades?.length) {
      return null
    }

    const dayPnl = getDayPnl(dayTrades)
    const prefix = dayPnl >= 0 ? '+$' : '-$'
    const absVal = Math.abs(dayPnl)
    const formatted =
      absVal >= 1000 ? `${prefix}${(absVal / 1000).toFixed(1)}k` : `${prefix}${absVal.toFixed(0)}`

    return (
      <p className={`tile-pnl ${dayPnl >= 0 ? 'positive' : dayPnl < 0 ? 'negative' : ''}`}>
        {formatted}
      </p>
    )
  }

  const selectedDayPnl = selectedDateTrades.reduce(
    (sum, trade) => sum + Number(trade.pnl || 0),
    0,
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-icon">📈</div>
          <div className="header-text">
            <p className="eyebrow">Trade Journal</p>
            <h1>Rule-First Dashboard</h1>
            <p className="subtitle">Track trades, follow your rules, grow with discipline.</p>
          </div>
        </div>
        <div className="header-pnl">
          <p className="label">Total P&amp;L</p>
          <p className={`value ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(totalPnl)}
          </p>
        </div>
      </header>

      {!firebaseEnabled && (
        <section className="notice">
          ⚡ Firebase not configured — saving locally in your browser.
        </section>
      )}

      {errorMessage && <section className="error-banner">⚠ {errorMessage}</section>}

      <nav className="app-nav" aria-label="Main navigation">
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id]
          return (
            <button
              key={tab.id}
              type="button"
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <main className="app-main">
        {activeTab === 'dashboard' && (
          <div className="tab-panel dashboard-layout">
            <div className="hero-stats">
              <article className="hero-stat" style={{ '--stat-accent': CHART.profit, '--stat-bg': 'var(--profit-dim)' }}>
                <div className="stat-icon">💰</div>
                <p className="stat-label">Total P&amp;L</p>
                <p className={`stat-value ${totalPnl >= 0 ? 'positive' : 'negative'}`}>{formatCurrency(totalPnl)}</p>
              </article>
              <article className="hero-stat" style={{ '--stat-accent': CHART.accent, '--stat-bg': 'var(--accent-dim)' }}>
                <div className="stat-icon">🎯</div>
                <p className="stat-label">Win Rate</p>
                <p className="stat-value">{winRate.toFixed(1)}%</p>
                <p className="stat-sub">{winningTrades}W / {losingTrades}L of {totalTrades}</p>
              </article>
              <article className="hero-stat" style={{ '--stat-accent': '#a78bfa', '--stat-bg': 'rgba(167,139,250,0.12)' }}>
                <div className="stat-icon">📊</div>
                <p className="stat-label">Profit Factor</p>
                <p className={`stat-value ${profitFactor !== '-' && profitFactor !== 'Infinite' && Number(profitFactor) > 1 ? 'positive' : profitFactor === '-' ? '' : 'negative'}`}>{profitFactor}</p>
              </article>
              <article className="hero-stat" style={{ '--stat-accent': CHART.accent, '--stat-bg': 'var(--accent-dim)' }}>
                <div className="stat-icon">⚖️</div>
                <p className="stat-label">R:R Ratio</p>
                <p className="stat-value">{rrRatio ? `1 : ${rrRatio.toFixed(2)}` : '—'}</p>
              </article>
            </div>

            <div className="strategy-pnl-row">
              {strategyPnlBreakdown.map((item) => (
                <article
                  key={item.strategy}
                  className="strategy-pnl-card"
                  style={{ '--strategy-color': STRATEGY_COLORS[item.strategy] }}
                >
                  <p className="strategy-name">{item.strategy}</p>
                  <p className={`strategy-pnl ${item.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(item.totalPnl)}
                  </p>
                  <p className="strategy-trades">{item.trades} trades</p>
                </article>
              ))}
            </div>

            <div className="stats-section">
              <div className="stats-section-header">
                <h3>Performance Metrics</h3>
              </div>
              <div className="stats-grid">
            <article className="stat-card">
              <h3>Current Win Streak</h3>
              <p className="positive">{streakData.currentWinStreak}</p>
            </article>
            <article className="stat-card">
              <h3>Longest Win Streak</h3>
              <p className="positive">{streakData.longestWinStreak}</p>
            </article>
            <article className="stat-card">
              <h3>Current Loss Streak</h3>
              <p className="negative">{streakData.currentLossStreak}</p>
            </article>
            <article className="stat-card">
              <h3>Max Consecutive Losses</h3>
              <p className="negative">{streakData.maxConsecutiveLosingDays}</p>
            </article>
            <article className="stat-card">
              <h3>Profitable Days</h3>
              <p className="positive">{profitableVsUnprofitableDays.profitableDays}</p>
            </article>
            <article className="stat-card">
              <h3>Unprofitable Days</h3>
              <p className="negative">{profitableVsUnprofitableDays.unprofitableDays}</p>
            </article>
            <article className="stat-card">
              <h3>Rules Followed Days</h3>
              <p>{ruleStats.followed}</p>
            </article>
            <article className="stat-card">
              <h3>Rules Broken Days</h3>
              <p>{ruleStats.notFollowed}</p>
            </article>
            <article className="stat-card">
              <h3>Total Trades</h3>
              <p>{totalTrades}</p>
            </article>
            <article className="stat-card">
              <h3>Average Trade PnL</h3>
              <p className={averageTradePnl >= 0 ? 'positive' : 'negative'}>
                {formatCurrency(averageTradePnl)}
              </p>
            </article>
            <article className="stat-card">
              <h3>Average Points</h3>
              <p>{averagePoints.toFixed(2)}</p>
            </article>
              </div>
            </div>

            <div className="charts-grid">
              <div className="chart-card">
                <h3>P&amp;L by Strategy</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={setupPnlData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="strategy" tick={{ fill: CHART.axis, fontSize: 11 }} />
                    <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={CHART.tooltip} />
                <Legend wrapperStyle={{ color: CHART.axis, fontSize: 12 }} />
                <Bar dataKey="pnl" name="P&L">
                  {setupPnlData.map((entry) => (
                    <Cell key={entry.strategy} fill={entry.fill} />
                  ))}
                </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="double-chart">
                <div className="chart-card">
                  <h3>Trades by Strategy</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Tooltip contentStyle={CHART.tooltip} />
                  <Pie
                    data={strategyDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label
                  >
                      {strategyDistribution.map((entry) => (
                        <Cell key={entry.name} fill={STRATEGY_COLORS[entry.name] || CHART.accent} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>Recent Day PnL Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={dailyPnlData.slice(-20)}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                      <XAxis dataKey="date" tick={{ fill: CHART.axis, fontSize: 10 }} />
                      <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} />
                      <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={CHART.tooltip} />
                      <Line type="monotone" dataKey="pnl" stroke={CHART.accent} strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="chart-card">
                <h3>Account Growth (Cumulative PnL)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={accountGrowthData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="date" tick={{ fill: CHART.axis, fontSize: 10 }} />
                    <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={CHART.tooltip} />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      name="Account Growth"
                      stroke={CHART.profit}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="performance-tables">
              <div className="chart-card">
                <h3>Strategy Performance</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Trades</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Total P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyPerformance.map((row) => (
                    <tr key={row.strategy}>
                      <td>{row.strategy}</td>
                      <td>{row.trades}</td>
                      <td className="positive">{row.wins}</td>
                      <td className="negative">{row.losses}</td>
                      <td>{row.winRate.toFixed(1)}%</td>
                      <td className={row.totalPnl >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(row.totalPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

              <div className="chart-card">
                <h3>Monthly Performance Summary</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Trading Days</th>
                    <th>Trades</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Total PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPerformance.map((month) => (
                    <tr key={month.month}>
                      <td>{month.month}</td>
                      <td>{month.tradingDays}</td>
                      <td>{month.trades}</td>
                      <td className="positive">{month.wins}</td>
                      <td className="negative">{month.losses}</td>
                      <td>{month.winRate.toFixed(1)}%</td>
                      <td className={month.pnl >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(month.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
                </div>
              </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'trade' && (
          <div className="tab-panel">
            <div className="trade-layout">
              <section className="panel">
                <h2 className="panel-title">Log a Trade</h2>
                <form className="trade-form" onSubmit={handleAddTrade}>
                  <div className="form-group form-group-date full-width">
                    <label htmlFor="trade-date">Trade Date</label>
                    <p className="field-hint">Defaults to today. Pick any past date to backfill trades.</p>
                    <div className="date-input-row">
                      <input
                        id="trade-date"
                        type="date"
                        name="date"
                        value={form.date}
                        onChange={handleFieldChange}
                        max={getTodayDateKey()}
                        required
                      />
                      <div className="date-quick-btns">
                        <button type="button" className="btn-secondary" onClick={setTradeDateToToday}>
                          Today
                        </button>
                        <button type="button" className="btn-secondary" onClick={setTradeDateToYesterday}>
                          Yesterday
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-strategy">Strategy</label>
                    <select id="trade-strategy" name="strategy" value={form.strategy} onChange={handleFieldChange}>
                      {STRATEGIES.map((strategy) => (
                        <option key={strategy} value={strategy}>{strategy}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-lot">Quantity (Lots)</label>
                    <input
                      id="trade-lot"
                      type="number"
                      min="1"
                      max={STRATEGY_RULES[form.strategy].maxLotSize}
                      step="1"
                      name="lotSize"
                      value={form.lotSize}
                      onChange={handleFieldChange}
                      required
                    />
                    <p className="field-hint">
                      Max {STRATEGY_RULES[form.strategy].maxLotSize} lot(s) for {form.strategy}
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-points">Points Captured (optional)</label>
                    <input id="trade-points" type="number" step="0.01" name="pointsCaptured" value={form.pointsCaptured} onChange={handleFieldChange} placeholder="e.g. 12.5" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-pnl">Profit / Loss ($)</label>
                    <input id="trade-pnl" type="number" step="0.01" name="pnl" value={form.pnl} onChange={handleFieldChange} placeholder="e.g. 25 or -5" required />
                    <p className="field-hint">
                      Max loss for {form.strategy}: ${STRATEGY_RULES[form.strategy].maxLossPerTrade}
                    </p>
                  </div>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save Trade'}
                  </button>
                </form>
              </section>
              <aside className="rules-card">
                <h3>📋 Trading Rules</h3>
                <ul className="rules-list">
                  {STRATEGIES.map((strategy, index) => {
                    const rules = STRATEGY_RULES[strategy]
                    return (
                      <li key={strategy}>
                        <span className="rule-num">{index + 1}</span>
                        <div className="rule-detail">
                          <strong>{strategy}</strong>
                          <span>Max {rules.maxTradesPerDay} trades/day · Max {rules.maxLotSize} lot(s) · Max loss ${rules.maxLossPerTrade}/trade</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </aside>
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="tab-panel">
            <div className="calendar-layout">
              <section className="panel calendar-panel-wide">
                <h2 className="panel-title">Trading Calendars</h2>

                <div className="dual-calendar-grid">
                  <div className="calendar-block">
                    <h3 className="calendar-block-title">Rules Calendar</h3>
                    <p className="calendar-block-desc">Green = rules followed, red = rules broken</p>
                    <div className="calendar-legend">
                      <span className="legend-item">
                        <span className="legend-dot followed" /> Followed
                      </span>
                      <span className="legend-item">
                        <span className="legend-dot broken" /> Broken
                      </span>
                    </div>
                    <Calendar
                      value={selectedDate}
                      onChange={handleCalendarChange}
                      tileClassName={rulesTileClassName}
                    />
                  </div>

                  <div className="calendar-block">
                    <h3 className="calendar-block-title">P&amp;L Calendar</h3>
                    <p className="calendar-block-desc">Green = profitable day, red = losing day</p>
                    <div className="calendar-legend">
                      <span className="legend-item">
                        <span className="legend-dot profitable" /> Profitable
                      </span>
                      <span className="legend-item">
                        <span className="legend-dot unprofitable" /> Loss
                      </span>
                      <span className="legend-item">Number = day P&amp;L</span>
                    </div>
                    <Calendar
                      value={selectedDate}
                      onChange={handleCalendarChange}
                      tileClassName={pnlTileClassName}
                      tileContent={pnlTileContent}
                    />
                  </div>
                </div>
              </section>

              <aside className="day-summary">
                <h3>{selectedDateKey}</h3>
                <div className="summary-metrics">
                  <div className="summary-metric">
                    <p className="label">Day P&amp;L</p>
                    <p className={`value ${selectedDayPnl >= 0 ? 'positive' : 'negative'}`}>
                      {formatCurrency(selectedDayPnl)}
                    </p>
                  </div>
                  <div className="summary-metric">
                    <p className="label">Trades</p>
                    <p className="value">{selectedDateTrades.length}</p>
                  </div>
                </div>

                {selectedDateTrades.length > 0 && (
                  <p>
                    <span className={`status-badge ${selectedDateEvaluation.followed ? 'followed' : 'broken'}`}>
                      {selectedDateEvaluation.followed ? '✓ Rules Followed' : '✗ Rules Broken'}
                    </span>
                  </p>
                )}

                {!selectedDateEvaluation.followed && selectedDateTrades.length > 0 && (
                  <ul className="reason-list">
                    {selectedDateEvaluation.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}

                <h4>Trades</h4>
                {selectedDateTrades.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📅</div>
                    <p>No trades logged for this day.</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Strategy</th>
                          <th>Lots</th>
                          <th>Pts</th>
                          <th>P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDateTrades.map((trade) => {
                          const strategy = getTradeStrategy(trade)
                          return (
                          <tr key={trade.id}>
                            <td>
                              <span className={`tag tag-${strategy.toLowerCase().replace(/\s+/g, '-')}`}>
                                {strategy}
                              </span>
                            </td>
                            <td className="mono">{trade.lotSize}</td>
                            <td className="mono">{trade.pointsCaptured || '—'}</td>
                            <td className={`mono ${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}`}>
                              {formatCurrency(trade.pnl)}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}

        {activeTab === 'learnings' && (
          <div className="tab-panel learning-layout">
            <section className="panel">
              <h2 className="panel-title">Daily Learning Notes</h2>
              <form className="learning-form" onSubmit={handleAddLearning}>
                <div className="form-group">
                  <label htmlFor="learning-date">Date</label>
                  <input
                    id="learning-date"
                    type="date"
                    name="date"
                    value={learningForm.date}
                    onChange={handleLearningFieldChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="learning-note">What did you learn?</label>
                  <textarea
                    id="learning-note"
                    name="note"
                    rows="3"
                    value={learningForm.note}
                    onChange={handleLearningFieldChange}
                    placeholder="Mistakes, wins, patterns to remember…"
                    required
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={isSavingLearning}>
                  {isSavingLearning ? 'Saving…' : 'Save Note'}
                </button>
              </form>
            </section>

            <section className="panel">
              <h2 className="panel-title">
                All Notes <span className="badge">{learningTableData.length}</span>
              </h2>
              {learningTableData.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📝</div>
                  <p>No learning notes yet. Start capturing your insights.</p>
                </div>
              ) : (
                <div className="learning-cards">
                  {learningTableData.map((learning, index) => (
                    <article key={learning.id || `${learning.date}-${index}`} className="learning-card">
                      <p className="date">{learning.date}</p>
                      <p className="note">{learning.note}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
