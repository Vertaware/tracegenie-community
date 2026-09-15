import type { NextFunction,Request,RequestHandler,Response } from "express";

export function asyncHandler(
  fn: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void fn(request, response, next).catch(next);
  };
}

export function asyncMiddleware(
  fn: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    void fn(request, response, next).catch(next);
  };
}

export function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? "";
}
