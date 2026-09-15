import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../lib/http";
import { requireAdmin } from "./auth.middleware";
import { authService } from "./auth.service";
import { ADMIN_SESSION_COOKIE_NAME,buildAdminSessionCookieOptions } from "./auth.session";

const router = Router();

router.post(
  "/login",
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
      })
      .parse(request.body);

    const result = await authService.login(body.email, body.password);
    response.cookie(ADMIN_SESSION_COOKIE_NAME, result.sessionToken, buildAdminSessionCookieOptions());
    response.json({
      token: "cookie-session",
      user: result.user,
    });
  }),
);

router.post(
  "/password-reset/request",
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        email: z.string().email(),
      })
      .parse(request.body);

    response.json(await authService.requestPasswordReset(body.email));
  }),
);

router.post(
  "/password-reset/confirm",
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        token: z.string().trim().min(20),
        password: z.string().min(8),
      })
      .parse(request.body);

    const result = await authService.resetPassword(body);
    response.cookie(ADMIN_SESSION_COOKIE_NAME, result.sessionToken, buildAdminSessionCookieOptions());
    response.json({
      token: "cookie-session",
      user: result.user,
    });
  }),
);

router.get(
  "/me",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json({ user: request.adminUser });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (_request, response) => {
    response.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
      ...buildAdminSessionCookieOptions(),
      maxAge: undefined,
    });
    response.status(204).send();
  }),
);

export { router as authRouter };
