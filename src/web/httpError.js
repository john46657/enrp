// Fehler mit HTTP-Status; die Meldung wird dem Besucher angezeigt.
module.exports = class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
