import { Header } from '../../components/Header';
import { DashboardWorkspace } from '../../components/DashboardWorkspace';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { useDashboard } from '../../hooks/useDashboard';

function DashboardPage() {
  const failed = useDashboard();
  return <><div id="glow-bg" aria-hidden="true" /><Header />
    {failed && <p className="dashboard-error" role="alert">The dashboard could not start. Reload this tab to try again.</p>}
    <DashboardWorkspace /></>;
}

export default function App() {
  return <ThemeProvider><DashboardPage /></ThemeProvider>;
}
