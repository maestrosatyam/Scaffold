import '../ui/tokens.css';
import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({ name: 'x', version: '1' });
app.ontoolresult = (r) => { document.body.textContent = JSON.stringify(r.structuredContent); };
void app.connect();
