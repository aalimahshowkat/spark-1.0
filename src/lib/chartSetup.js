import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

Chart.defaults.font.family = "'Geist', 'Instrument Sans', sans-serif"
Chart.defaults.font.size   = 11
Chart.defaults.color       = '#6b7394'

export const CHART_COLORS = {
  CSM:      '#2857a4',
  PM:       '#2a7a52',
  Analyst:  '#6b3fa0',
  Bond:     '#2857a4',
  Validate: '#2a7a52',
  Integrate:'#c84b31',
  Explore:  '#c47b1a',
  red:      '#c84b31',
  amber:    '#c47b1a',
  green:    '#2a7a52',
  grid:     '#f0ede6',
}

export const COMMON_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false } },
    y: { grid: { color: CHART_COLORS.grid } },
  },
}
