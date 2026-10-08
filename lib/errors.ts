/** An error whose message is safe and useful to show the user. */
export class UserFacingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "UserFacingError";
  }
}
