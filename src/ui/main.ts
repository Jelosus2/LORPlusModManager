import "./assets/main.css";

import { RendererLogger } from "./utils/RendererLogger.ts";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";

RendererLogger.install();

const pinia = createPinia();
const app = createApp(App);

app.config.errorHandler = (error, _instance, information) => {
    RendererLogger.error("Vue", `An unhandled Vue error occurred during ${information}.`, error);
};

app.use(pinia);
app.mount("#app");
