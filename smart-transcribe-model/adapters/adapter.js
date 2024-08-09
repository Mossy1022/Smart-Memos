/**
 * Represents a generic adapter class that initializes with a main context and copies its configuration.
 */
export class Adapter {
  /**
   * Constructs an instance of Adapter.
   * @param {object} main - The main context object which should contain a configuration object.
   */
  constructor(main) {
    /**
     * The main context object from which configuration is derived.
     * @type {object}
     */
    this.main = main;

    /**
     * Copies properties from the main object's config property to this instance.
     */
    Object.assign(this, main.config); // Copy config to this
  }
}
