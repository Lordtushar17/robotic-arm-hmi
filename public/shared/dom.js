// Short helper for getElementById. Only call it after the section HTML has loaded
// (that is, inside an init function, not at the top of a module).
export const $ = (id) => document.getElementById(id);
