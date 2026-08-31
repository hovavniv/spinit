/**
 * The id of the page's one real <form>. The ceremony inputs live OUTSIDE it
 * and reach it through `form={DETAILS_FORM_ID}`, because wrapping them would
 * nest the four list sections' own forms and the HTML parser drops nested
 * forms (design §2.2). The notes textareas have their own forms and their own
 * actions now — they no longer use this id at all.
 */
export const DETAILS_FORM_ID = 'event-details';
