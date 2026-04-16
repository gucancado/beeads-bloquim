import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: "Too Many Requests",
    message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
  },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Muitas tentativas de cadastro. Tente novamente em uma hora.",
  },
});
