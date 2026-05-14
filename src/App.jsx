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
  const [showTradeForm, setShowTradeForm] = useState(false)

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
      fill: pnl >= 0 ? '#2e8b57' : '#cf3b2f',
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
      setShowTradeForm(false)
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

  function tileClassName({ date, view }) {
    if (view !== 'month') {
      return null
    }

    const key = toDateKey(date)
    if (!dayEvaluationMap[key]) {
      return null
    }

    return dayEvaluationMap[key].followed ? 'tile-followed' : 'tile-broken'
  }

  function tileContent({ date, view }) {
    if (view !== 'month') {
      return null
    }

    const key = toDateKey(date)
    const dayTrades = tradesByDate[key]

    if (!dayTrades?.length) {
      return null
    }

    const dayPnl = dayTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
    return <p className="tile-pnl">{dayPnl >= 0 ? '+' : ''}{dayPnl}</p>
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Trading Journal</p>
        <h1>Rule-First Trading Dashboard</h1>
        <p className="subtitle">
          Calendar color is based on your trading rules. PnL is shown day-wise and strategy-wise.
        </p>
      </header>

      {!firebaseEnabled && (
        <section className="notice">
          Firebase keys are missing. App is running with local browser storage.
        </section>
      )}

      {errorMessage && <section className="error-banner">{errorMessage}</section>}

      <main className="layout-grid">
        <section className="panel trade-panel">
          <div className="panel-heading">
            <h2>Add Trade Entry</h2>
            <button
              type="button"
              className="toggle-form-btn"
              onClick={() => setShowTradeForm((prev) => !prev)}
            >
              {showTradeForm ? 'Close Entry' : '+ Add Trade'}
            </button>
          </div>

          {showTradeForm && (
            <form className="trade-form" onSubmit={handleAddTrade}>
              <label>
                Trade Date
                <input
                  type="date"
                  name="date"
                  value={form.date}
                  onChange={handleFieldChange}
                  required
                />
              </label>

              <label>
                Script
                <select name="script" value={form.script} onChange={handleFieldChange}>
                  {SCRIPT_OPTIONS.map((script) => (
                    <option key={script} value={script}>
                      {script}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Lot Size
                <input
                  type="number"
                  min="0"
                  step="1"
                  name="lotSize"
                  value={form.lotSize}
                  onChange={handleFieldChange}
                  required
                />
              </label>

              <label>
                Points Captured
                <input
                  type="number"
                  step="0.01"
                  name="pointsCaptured"
                  value={form.pointsCaptured}
                  onChange={handleFieldChange}
                  required
                />
              </label>

              <label>
                Profit/Loss (PnL)
                <input
                  type="number"
                  step="0.01"
                  name="pnl"
                  value={form.pnl}
                  onChange={handleFieldChange}
                  required
                />
              </label>

              <label>
                Setup
                <select name="setup" value={form.setup} onChange={handleFieldChange}>
                  {SETUP_OPTIONS.map((setup) => (
                    <option key={setup} value={setup}>
                      {setup}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Trade Source
                <select
                  name="source"
                  value={form.source}
                  onChange={handleFieldChange}
                  disabled={form.setup === 'Live Stream'}
                >
                  {SOURCE_OPTIONS.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Trade'}
              </button>
            </form>
          )}

          <div className="rules-box">
            <h3>Your Rules</h3>
            <ul>
              <li>GOLD must be 1 lot</li>
              <li>Maximum 5 trades/day</li>
              <li>Self trades: max 2/day</li>
              <li>Live Stream trades: max 3/day</li>
            </ul>
          </div>
        </section>

        <section className="panel stats-panel">
          <h2>Dashboard</h2>
          <div className="stats-grid">
            <article className="stat-card">
              <h3>Total PnL Till Now</h3>
              <p className={totalPnl >= 0 ? 'positive' : 'negative'}>{formatCurrency(totalPnl)}</p>
            </article>
            <article className="stat-card">
              <h3>Win Rate</h3>
              <p>{winRate.toFixed(1)}%</p>
            </article>
            <article className="stat-card">
              <h3>Profit Factor</h3>
              <p className={profitFactor !== '-' && profitFactor !== 'Infinite' && Number(profitFactor) > 1 ? 'positive' : 'negative'}>
                {profitFactor}
              </p>
            </article>
            <article className="stat-card">
              <h3>R:R Ratio</h3>
              <p>{rrRatio ? `1 : ${rrRatio.toFixed(2)}` : '-'}</p>
            </article>
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

          <div className="chart-wrap">
            <h3>PnL by Setup</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={setupPnlData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cfd6df" />
                <XAxis dataKey="setup" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="pnl" name="PnL">
                  {setupPnlData.map((entry) => (
                    <Cell key={entry.setup} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-wrap double-chart">
            <article className="mini-chart-card">
              <h3>Trade Source Split</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Tooltip />
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
                      <Cell key={entry.name} fill={entry.name === 'Self' ? '#1f7a43' : '#ce6f1d'} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </article>

            <article className="mini-chart-card">
              <h3>Recent Day PnL Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyPnlData.slice(-20)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d2d9e3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Line type="monotone" dataKey="pnl" stroke="#214e8a" strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            </article>
          </div>

          <div className="chart-wrap">
            <h3>Account Growth (Cumulative PnL)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={accountGrowthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d2d9e3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Line
                  type="monotone"
                  dataKey="equity"
                  name="Account Growth"
                  stroke="#0f7a62"
                  strokeWidth={3}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-wrap">
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

          <div className="chart-wrap">
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

          <div className="chart-wrap">
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

        </section>

        <section className="panel calendar-panel">
          <h2>Trading Calendar</h2>
          <p className="calendar-caption">
            Green means rules followed, red means rules broken. Number is day PnL.
          </p>

          <Calendar
            value={selectedDate}
            onChange={handleCalendarChange}
            tileClassName={tileClassName}
            tileContent={tileContent}
          />

          <div className="selected-day-box">
            <h3>{selectedDateKey} Summary</h3>
            <p>
              Day PnL:{' '}
              <strong>
                {formatCurrency(
                  selectedDateTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0),
                )}
              </strong>
            </p>

            {selectedDateTrades.length > 0 && (
              <p>
                Rule status:{' '}
                <strong className={selectedDateEvaluation.followed ? 'positive' : 'negative'}>
                  {selectedDateEvaluation.followed ? 'Followed' : 'Broken'}
                </strong>
              </p>
            )}

            {!selectedDateEvaluation.followed && selectedDateTrades.length > 0 && (
              <ul className="reason-list">
                {selectedDateEvaluation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            <h4>Trades of Selected Day</h4>
            {selectedDateTrades.length === 0 ? (
              <p>No trades for this day.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Script</th>
                      <th>Lot</th>
                      <th>Points</th>
                      <th>PnL</th>
                      <th>Setup</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDateTrades.map((trade) => (
                      <tr key={trade.id}>
                        <td>{trade.script}</td>
                        <td>{trade.lotSize}</td>
                        <td>{trade.pointsCaptured}</td>
                        <td className={Number(trade.pnl) >= 0 ? 'positive' : 'negative'}>{trade.pnl}</td>
                        <td>{trade.setup}</td>
                        <td>{trade.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="panel learning-panel">
          <h2>Daily Learning Notes</h2>
          <form className="learning-form" onSubmit={handleAddLearning}>
            <label>
              Date
              <input
                type="date"
                name="date"
                value={learningForm.date}
                onChange={handleLearningFieldChange}
                required
              />
            </label>

            <label className="learning-note-field">
              Learning Note
              <textarea
                name="note"
                rows="3"
                value={learningForm.note}
                onChange={handleLearningFieldChange}
                placeholder="What did you learn from today's trading?"
                required
              />
            </label>

            <button type="submit" disabled={isSavingLearning}>
              {isSavingLearning ? 'Saving...' : 'Save Learning'}
            </button>
          </form>

          <h3>All Learnings</h3>
          {learningTableData.length === 0 ? (
            <p>No learning notes added yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Learning</th>
                  </tr>
                </thead>
                <tbody>
                  {learningTableData.map((learning, index) => (
                    <tr key={learning.id || `${learning.date}-${index}`}>
                      <td>{learning.date}</td>
                      <td>{learning.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
