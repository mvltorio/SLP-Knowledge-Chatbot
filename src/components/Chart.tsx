<<<<<<< HEAD
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { ChartSpec } from '../types';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

interface ChartComponentProps {
  spec: ChartSpec;
}

export default function Chart({ spec }: ChartComponentProps) {
=======
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts'
import { ChartSpec } from '../types'

const COLORS = ['#10b981','#3b82f6','#f59e0b','#ef4444','#6366f1','#14b8a6']

interface ChartComponentProps {
  spec: ChartSpec
}

// Make sure this is a default export
const Chart = ({ spec }: ChartComponentProps) => {
  // Convert labels/values → data if needed
  const chartData = spec.data || []

>>>>>>> eaffcb4e7892a08afee9778f4ea3ff374522b3b6
  const renderChart = () => {
    switch (spec.chartType) {
      case 'bar':
        return (
<<<<<<< HEAD
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey={spec.dataKey || 'value'} fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey={spec.dataKey || 'value'} stroke="#82ca9d" />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={spec.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {spec.data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      default:
        return <p>Unsupported chart type</p>;
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 my-4">
      {spec.title && <h3 className="text-lg font-semibold text-center mb-4">{spec.title}</h3>}
      {renderChart()}
    </div>
  );
}
=======
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3"/>
              <XAxis dataKey="name"/>
              <YAxis/>
              <Tooltip/>
              <Legend/>
              <Bar dataKey={spec.dataKey || "value"} fill="#10b981"/>
            </BarChart>
          </ResponsiveContainer>
        )

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3"/>
              <XAxis dataKey="name"/>
              <YAxis/>
              <Tooltip/>
              <Legend/>
              <Line
                type="monotone"
                dataKey={spec.dataKey || "value"}
                stroke="#3b82f6"
              />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]}/>
                ))}
              </Pie>
              <Tooltip/>
              <Legend/>
            </PieChart>
          </ResponsiveContainer>
        )

      default:
        return <p>Unsupported chart type</p>
    }
  }

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 my-4">
      {spec.title && (
        <h3 className="text-lg font-semibold text-center mb-4">
          {spec.title}
        </h3>
      )}
      {renderChart()}
    </div>
  )
}

export default Chart
>>>>>>> eaffcb4e7892a08afee9778f4ea3ff374522b3b6
