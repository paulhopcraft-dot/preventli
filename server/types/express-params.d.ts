// Override ParamsDictionary so req.params values are typed as `string`
// (URL route params cannot actually be arrays; the installed @types/express
// types them as string | string[] but that's overly broad for our use).
declare module "express-serve-static-core" {
  interface ParamsDictionary {
    [key: string]: string;
  }
}

export {};
