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

const SCRIPT_OPTIONS = ['GOLD', 'BTC']
const SETUP_OPTIONS = ['OHCL', 'Trap/Reversal Zone', 'Live Stream']
const SOURCE_OPTIONS = ['Self', 'Live Stream']

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

const DEFAULT_FORM = {
  date: new Date().toISOString().slice(0, 10),
  script: 'GOLD',
  lotSize: 1,
  pointsCaptured: '',
  pnl: '',
  setup: 'OHCL',
  source: 'Self',
}

const DEFAULT_LEARNING_FORM = {
  date: new Date().toISOString().slice(0, 10),
  note: '',
}

function toDateKey(dateInput) {
  const date = new Date(dateInput)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function evaluateDayRules(dayTrades) {
  if (!dayTrades.length) {
    return { followed: null, reasons: [] }
  }

  const selfTrades = dayTrades.filter((trade) => trade.source === 'Self').length
  const liveTrades = dayTrades.filter((trade) => trade.source === 'Live Stream').length
  const invalidGoldLot = dayTrades.some(
    (trade) => trade.script === 'GOLD' && Number(trade.lotSize) !== 1,
  )

  const reasons = []

  if (dayTrades.length > 5) {
    reasons.push('More than 5 trades in one day')
  }
  if (selfTrades > 2) {
    reasons.push('Self trades are more than 2')
  }
  if (liveTrades > 3) {
    reasons.push('Live stream trades are more than 3')
  }
  if (invalidGoldLot) {
    reasons.push('Gold trades must use lot size 1')
  }

  return {
    followed: reasons.length === 0,
    reasons,
  }
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
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
    return Array.isArray(parsedTrades) ? parsedTrades : []
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
  const [form, setForm] = useState(DEFAULT_FORM)
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
          const nextTrades = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
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
    const setupMap = {}
    SETUP_OPTIONS.forEach((setup) => {
      setupMap[setup] = 0
    })

    trades.forEach((trade) => {
      setupMap[trade.setup] = (setupMap[trade.setup] || 0) + Number(trade.pnl || 0)
    })

    return Object.entries(setupMap).map(([setup, pnl]) => ({
      setup,
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

  const sourceDistribution = useMemo(() => {
    const sourceMap = { Self: 0, 'Live Stream': 0 }
    trades.forEach((trade) => {
      sourceMap[trade.source] = (sourceMap[trade.source] || 0) + 1
    })

    return Object.entries(sourceMap).map(([name, value]) => ({
      name,
      value,
    }))
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

  const setupPerformance = useMemo(() => {
    const setupMap = {}
    SETUP_OPTIONS.forEach((setup) => {
      setupMap[setup] = {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
    })

    trades.forEach((trade) => {
      const setup = setupMap[trade.setup] || {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
      setup.trades += 1
      setup.totalPnl += Number(trade.pnl || 0)
      if (Number(trade.pnl) > 0) {
        setup.wins += 1
      } else if (Number(trade.pnl) < 0) {
        setup.losses += 1
      }
      setup.winRate = setup.trades > 0 ? (setup.wins / setup.trades) * 100 : 0
      setupMap[trade.setup] = setup
    })

    return Object.entries(setupMap)
      .map(([setup, data]) => ({
        setup,
        ...data,
      }))
      .filter((item) => item.trades > 0)
  }, [trades])

  const scriptPerformance = useMemo(() => {
    const scriptMap = {}
    SCRIPT_OPTIONS.forEach((script) => {
      scriptMap[script] = {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
    })

    trades.forEach((trade) => {
      const script = scriptMap[trade.script] || {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0,
      }
      script.trades += 1
      script.totalPnl += Number(trade.pnl || 0)
      if (Number(trade.pnl) > 0) {
        script.wins += 1
      } else if (Number(trade.pnl) < 0) {
        script.losses += 1
      }
      script.winRate = script.trades > 0 ? (script.wins / script.trades) * 100 : 0
      scriptMap[trade.script] = script
    })

    return Object.entries(scriptMap)
      .map(([script, data]) => ({
        script,
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

    if (name === 'setup' && value === 'Live Stream') {
      setForm((prev) => ({ ...prev, setup: value, source: 'Live Stream' }))
      return
    }

    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleAddTrade(event) {
    event.preventDefault()
    setErrorMessage('')

    const tradeToSave = {
      date: form.date,
      script: form.script,
      lotSize: Number(form.lotSize),
      pointsCaptured: Number(form.pointsCaptured),
      pnl: Number(form.pnl),
      setup: form.setup,
      source: form.source,
      createdAt: new Date().toISOString(),
    }

    if (Number.isNaN(tradeToSave.pointsCaptured) || Number.isNaN(tradeToSave.pnl)) {
      setErrorMessage('Points and PnL must be valid numbers.')
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

      setForm({ ...DEFAULT_FORM, date: form.date })
      setSelectedDate(new Date(form.date))
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
    const formatted =
      Math.abs(dayPnl) >= 1000
        ? `${dayPnl >= 0 ? '+' : ''}${(dayPnl / 1000).toFixed(1)}k`
        : `${dayPnl >= 0 ? '+' : ''}${dayPnl}`

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
                <h3>PnL by Setup</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={setupPnlData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="setup" tick={{ fill: CHART.axis, fontSize: 11 }} />
                    <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={CHART.tooltip} />
                <Legend wrapperStyle={{ color: CHART.axis, fontSize: 12 }} />
                <Bar dataKey="pnl" name="PnL">
                  {setupPnlData.map((entry) => (
                    <Cell key={entry.setup} fill={entry.fill} />
                  ))}
                </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="double-chart">
                <div className="chart-card">
                  <h3>Trade Source Split</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Tooltip contentStyle={CHART.tooltip} />
                  <Pie
                    data={sourceDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label
                  >
                      {sourceDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.name === 'Self' ? CHART.profit : '#fb923c'} />
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
                <h3>Setup Performance</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th>Trades</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Total PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {setupPerformance.map((setup) => (
                    <tr key={setup.setup}>
                      <td>{setup.setup}</td>
                      <td>{setup.trades}</td>
                      <td className="positive">{setup.wins}</td>
                      <td className="negative">{setup.losses}</td>
                      <td>{setup.winRate.toFixed(1)}%</td>
                      <td className={setup.totalPnl >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(setup.totalPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

              <div className="chart-card">
                <h3>Script Performance</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Script</th>
                    <th>Trades</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Total PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {scriptPerformance.map((script) => (
                    <tr key={script.script}>
                      <td>{script.script}</td>
                      <td>{script.trades}</td>
                      <td className="positive">{script.wins}</td>
                      <td className="negative">{script.losses}</td>
                      <td>{script.winRate.toFixed(1)}%</td>
                      <td className={script.totalPnl >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(script.totalPnl)}
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
                  <div className="form-group">
                    <label htmlFor="trade-date">Trade Date</label>
                    <input id="trade-date" type="date" name="date" value={form.date} onChange={handleFieldChange} required />
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-script">Script</label>
                    <select id="trade-script" name="script" value={form.script} onChange={handleFieldChange}>
                      {SCRIPT_OPTIONS.map((script) => (
                        <option key={script} value={script}>{script}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-lot">Lot Size</label>
                    <input id="trade-lot" type="number" min="0" step="1" name="lotSize" value={form.lotSize} onChange={handleFieldChange} required />
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-points">Points Captured</label>
                    <input id="trade-points" type="number" step="0.01" name="pointsCaptured" value={form.pointsCaptured} onChange={handleFieldChange} placeholder="e.g. 12.5" required />
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-pnl">Profit / Loss (₹)</label>
                    <input id="trade-pnl" type="number" step="0.01" name="pnl" value={form.pnl} onChange={handleFieldChange} placeholder="e.g. 2500" required />
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-setup">Setup</label>
                    <select id="trade-setup" name="setup" value={form.setup} onChange={handleFieldChange}>
                      {SETUP_OPTIONS.map((setup) => (
                        <option key={setup} value={setup}>{setup}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="trade-source">Trade Source</label>
                    <select id="trade-source" name="source" value={form.source} onChange={handleFieldChange} disabled={form.setup === 'Live Stream'}>
                      {SOURCE_OPTIONS.map((source) => (
                        <option key={source} value={source}>{source}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save Trade'}
                  </button>
                </form>
              </section>
              <aside className="rules-card">
                <h3>📋 Your Trading Rules</h3>
                <ul className="rules-list">
                  <li><span className="rule-num">1</span> GOLD must always be 1 lot</li>
                  <li><span className="rule-num">2</span> Maximum 5 trades per day</li>
                  <li><span className="rule-num">3</span> Self trades: max 2 per day</li>
                  <li><span className="rule-num">4</span> Live Stream trades: max 3 per day</li>
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
                          <th>Script</th>
                          <th>Lot</th>
                          <th>Pts</th>
                          <th>P&amp;L</th>
                          <th>Setup</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDateTrades.map((trade) => (
                          <tr key={trade.id}>
                            <td>
                              <span className={`tag ${trade.script === 'GOLD' ? 'tag-gold' : 'tag-btc'}`}>
                                {trade.script}
                              </span>
                            </td>
                            <td className="mono">{trade.lotSize}</td>
                            <td className="mono">{trade.pointsCaptured}</td>
                            <td className={`mono ${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}`}>
                              {formatCurrency(trade.pnl)}
                            </td>
                            <td>{trade.setup}</td>
                          </tr>
                        ))}
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
