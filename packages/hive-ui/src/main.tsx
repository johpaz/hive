import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { iniciarMotorDeMedios } from "@/lib/realtime/engine";

// Elige el motor de audio antes de que nadie pulse "voz"; si algo falla, queda el web.
void iniciarMotorDeMedios();

createRoot(document.getElementById("root")!).render(<App />);
