import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { ChartSpec } from "../types";

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#14b8a6"
];

interface ChartComponentProps {
  spec: ChartSpec;
}

export default function Chart({ spec }: ChartComponentProps) {
  const chartData = spec?.data ?? [];

  const renderChart = () => {
    switch (spec.chartType) {
      case "bar":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey={spec.dataKey || "value"} fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        );

      case "line":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey={spec.dataKey || "value"}
                stroke="#3b82f6"
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, percent = 0 }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
              >
                {chartData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      default:
        return <p className="text-gray-500 text-center py-8">Unsupported chart type</p>;
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 my-4">
      {spec?.title && (
        <h3 className="text-lg font-semibold text-center mb-4">
          {spec.title}
        </h3>
      )}
      {renderChart()}
    </div>
  );
}