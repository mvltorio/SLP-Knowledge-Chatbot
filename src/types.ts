export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any; // Allow for additional properties in bar/line charts
}

export interface ChartSpec {
  chartType: ChartType;
  data: ChartDataPoint[];
  title?: string;
  dataKey?: string; // Key for the value in bar/line charts
}

export interface FileDownload {
  id: number;
  name: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  chart?: ChartSpec;
  fileDownload?: FileDownload;
}
