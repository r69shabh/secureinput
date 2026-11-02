import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./index.css";

if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
