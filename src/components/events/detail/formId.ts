/**
 * The id of the page's one real <form>. The ceremony inputs and the notes
 * textarea live OUTSIDE it and reach it through `form={DETAILS_FORM_ID}`,
 * because wrapping them would nest the four list sections' own forms and the
 * HTML parser drops nested forms (design §2.2).
 */
export const DETAILS_FORM_ID = 'event-details';
