import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import router from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { requestLogger } from "./middlewares/requestLogger";
import { corsOptions } from "./lib/cors";
import { attachSentryErrorHandler } from "./lib/sentry";

const app: Express = express();

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestLogger);

app.use("/api", router);

// Sentry must wrap errors before our handler turns them into JSON responses,
// otherwise Sentry never sees them.
attachSentryErrorHandler(app);
app.use(errorHandler);

export default app;
