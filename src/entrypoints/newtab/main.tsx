import { createRoot } from 'react-dom/client';
import 'gridstack/dist/gridstack.min.css';
import '../../assets/styles.css';
import { bootstrapTheme } from '../../theme/preferences';
import App from './App';

bootstrapTheme();
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
