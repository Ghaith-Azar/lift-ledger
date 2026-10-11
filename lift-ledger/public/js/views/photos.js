import { api } from '../api.js';
import { h, clear, appendAll, icon, toast, safe, openSheet, fmtDate, todayStr, pluralize } from '../util.js';
import { resizeImage, blobToDataURL } from '../photoUtil.js';

const CATEGORY_LABEL = { upper: 'Upper body', lower: 'Lower body' };

const VERDICT_MAP = {
  improving: { cls: 'up', label: 'Looking like progress' },
  maintaining: { cls: 'flat', label: 'Holding steady' },
  hard_to_tell: { cls: '', label: 'Hard to tell from these photos' },
  less_defined: { cls: 'down', label: 'Less definition than before' },
};

function verdictBadge(verdict) {
  const m = VERDICT_MAP[verdict] || { cls: '', label: verdict };
  return h('span', { class: `badge ${m.cls}`.trim() }, m.label);
}

export async function photosView(container) {
  const root = h('div');
  container.append(root);

  let category = 'upper';
  let photos = [];
  let aiConfigured = false;

  const loadAIStatus = async () => {
    try {
      aiConfigured = (await api.get('/api/photos/ai-status')).configured;
    } catch {
      aiConfigured = false;
    }
  };
  const loadPhotos = async () => {
    photos = (await api.get(`/api/photos?category=${category}`)).photos;
  };

  const setArchived = safe(async (p, archived) => {
    await api.patch(`/api/photos/${p.id}`, { archived });
    await loadPhotos();
    render();
  });

  const removePhoto = async (p) => {
    await setArchived(p, true);
    toast('Photo removed', { actionLabel: 'Undo', onAction: () => setArchived(p, false) });
  };

  function editPhoto(p) {
    const dateInput = h('input', { type: 'date', value: p.date, 'aria-label': 'Date' });
    const noteInput = h('input', {
      type: 'text',
      maxlength: 300,
      value: p.notes || '',
      placeholder: 'Optional note',
      'aria-label': 'Note',
    });
    const save = safe(async () => {
      await api.patch(`/api/photos/${p.id}`, { date: dateInput.value, notes: noteInput.value.trim() || null });
      sheet.close();
      await loadPhotos();
      render();
    });
    const sheet = openSheet({
      title: 'Edit photo',
      body: h(
        'div',
        { class: 'stack' },
        h('label', { class: 'field-label' }, 'Date'),
        dateInput,
        h('label', { class: 'field-label' }, 'Note'),
        noteInput,
        h('button', { class: 'btn primary block', onClick: save }, 'Save')
      ),
    });
  }

  function openViewer(p) {
    const sheet = openSheet({
      title: fmtDate(p.date),
      body: h(
        'div',
        { class: 'stack' },
        h('img', { src: `/api/photos/${p.id}/image`, class: 'photo-viewer-img', alt: `Photo from ${fmtDate(p.date)}` }),
        p.notes ? h('p', {}, p.notes) : null,
        h(
          'div',
          { class: 'row', style: { gap: '8px' } },
          h(
            'button',
            {
              class: 'btn small',
              onClick: () => {
                sheet.close();
                editPhoto(p);
              },
            },
            icon('edit', 16),
            'Edit'
          ),
          p.archived
            ? h(
                'button',
                {
                  class: 'btn small',
                  onClick: () => {
                    sheet.close();
                    setArchived(p, false);
                  },
                },
                icon('restore', 16),
                'Restore'
              )
            : h(
                'button',
                {
                  class: 'btn small danger',
                  onClick: () => {
                    sheet.close();
                    removePhoto(p);
                  },
                },
                icon('x', 16),
                'Remove'
              )
        )
      ),
    });
  }

  function photoThumb(p) {
    return h(
      'button',
      { class: 'photo-thumb', onClick: () => openViewer(p), 'aria-label': `Photo from ${fmtDate(p.date)}` },
      h('img', { src: `/api/photos/${p.id}/image`, alt: '', loading: 'lazy' }),
      h('span', { class: 'photo-thumb-date' }, fmtDate(p.date, { weekday: false }))
    );
  }

  // ---------- Add photo ----------

  function openAddSheet() {
    const fileInput = h('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      'aria-label': 'Choose a photo',
    });
    const dateInput = h('input', { type: 'date', value: todayStr(), 'aria-label': 'Date' });
    const noteInput = h('input', { type: 'text', maxlength: 300, placeholder: 'Optional note', 'aria-label': 'Note' });
    const preview = h('div', { class: 'photo-preview-box' }, h('p', { class: 'muted small' }, 'Choose a photo to preview it here.'));
    const saveBtn = h('button', { class: 'btn primary block', disabled: true }, 'Save photo');
    let pendingBlob = null;

    fileInput.addEventListener(
      'change',
      safe(async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        clear(preview).append(h('p', { class: 'muted small' }, 'Resizing…'));
        saveBtn.disabled = true;
        const { blob } = await resizeImage(file);
        pendingBlob = blob;
        clear(preview).append(h('img', { src: URL.createObjectURL(blob), class: 'photo-preview-img', alt: '' }));
        saveBtn.disabled = false;
      })
    );

    const save = safe(async () => {
      if (!pendingBlob || !dateInput.value) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const dataUrl = await blobToDataURL(pendingBlob);
        await api.post('/api/photos', {
          date: dateInput.value,
          category,
          content_type: 'image/jpeg',
          data: dataUrl,
          notes: noteInput.value.trim() || null,
        });
        sheet.close();
        toast('Photo saved');
        await loadPhotos();
        render();
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save photo';
      }
    });
    saveBtn.addEventListener('click', save);

    const sheet = openSheet({
      title: `Add ${CATEGORY_LABEL[category].toLowerCase()} photo`,
      body: h(
        'div',
        { class: 'stack' },
        h('label', { class: 'field-label' }, 'Photo'),
        fileInput,
        preview,
        h('label', { class: 'field-label' }, 'Date'),
        dateInput,
        h('label', { class: 'field-label' }, 'Note (optional)'),
        noteInput,
        saveBtn
      ),
    });
  }

  // ---------- Compare + AI ----------

  function openCompareSheet() {
    if (photos.length < 2) {
      toast('Add at least two photos in this category to compare');
      return;
    }
    const sorted = [...photos].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    const byId = new Map(sorted.map((p) => [p.id, p]));

    const option = (p, selected) => h('option', { value: String(p.id), selected }, fmtDate(p.date));
    const fromSelect = h(
      'select',
      { 'aria-label': 'Earlier photo' },
      sorted.map((p) => option(p, p.id === sorted[0].id))
    );
    const toSelect = h(
      'select',
      { 'aria-label': 'Later photo' },
      sorted.map((p) => option(p, p.id === sorted[sorted.length - 1].id))
    );

    const imagesRow = h('div', { class: 'compare-row' });
    const aiSection = h('div', { class: 'compare-ai' });

    const runAnalysis = safe(async () => {
      clear(aiSection).append(h('p', { class: 'muted small' }, 'Thinking…'));
      const res = await api.post('/api/photos/analyze', {
        category,
        from_id: Number(fromSelect.value),
        to_id: Number(toSelect.value),
      });
      clear(aiSection).append(
        verdictBadge(res.verdict),
        h('p', { style: { marginTop: '8px' } }, res.summary),
        h(
          'p',
          { class: 'muted small', style: { marginTop: '6px' } },
          res.cached ? 'From an earlier comparison of these two photos.' : 'Just now.'
        )
      );
    });

    function paintAI() {
      if (fromSelect.value === toSelect.value) {
        clear(aiSection).append(h('p', { class: 'muted small' }, 'Pick two different photos to compare.'));
        return;
      }
      if (!aiConfigured) {
        clear(aiSection).append(
          h(
            'p',
            { class: 'muted small' },
            "AI analysis isn't set up on this server yet — see the README's “Progress photos” section."
          )
        );
        return;
      }
      clear(aiSection).append(
        h('button', { class: 'btn block', onClick: runAnalysis }, icon('sparkle', 16), 'Ask AI: am I improving?'),
        h(
          'p',
          { class: 'muted small', style: { marginTop: '6px' } },
          'A rough visual read, not a measurement — sends these two photos to the Gemini API.'
        )
      );
    }

    function paintImages() {
      const from = byId.get(Number(fromSelect.value));
      const to = byId.get(Number(toSelect.value));
      clear(imagesRow).append(
        h(
          'div',
          { class: 'compare-col' },
          h('img', { src: `/api/photos/${from.id}/image`, alt: `Photo from ${fmtDate(from.date)}` }),
          h('p', { class: 'muted small' }, fmtDate(from.date))
        ),
        h(
          'div',
          { class: 'compare-col' },
          h('img', { src: `/api/photos/${to.id}/image`, alt: `Photo from ${fmtDate(to.date)}` }),
          h('p', { class: 'muted small' }, fmtDate(to.date))
        )
      );
      paintAI();
    }

    fromSelect.addEventListener('change', paintImages);
    toSelect.addEventListener('change', paintImages);

    openSheet({
      title: 'Compare photos',
      body: h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'row', style: { gap: '10px' } },
          h('div', { class: 'grow' }, h('label', { class: 'field-label' }, 'Earlier'), fromSelect),
          h('div', { class: 'grow' }, h('label', { class: 'field-label' }, 'Later'), toSelect)
        ),
        imagesRow,
        aiSection
      ),
    });
    paintImages();
  }

  // ---------- Render ----------

  function render() {
    const segmented = h(
      'div',
      { class: 'segmented' },
      ['upper', 'lower'].map((c) =>
        h(
          'button',
          {
            'aria-pressed': String(category === c),
            onClick: safe(async () => {
              category = c;
              await loadPhotos();
              render();
            }),
          },
          CATEGORY_LABEL[c]
        )
      )
    );

    appendAll(clear(root), [
      h('a', { class: 'icon-btn', href: '#/progress', 'aria-label': 'Back to progress' }, icon('back', 24)),
      h(
        'div',
        { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Progress photos'), h('p', {}, pluralize(photos.length, 'photo'))),
        segmented
      ),
      h(
        'div',
        { class: 'row', style: { gap: '8px', margin: '4px 0 16px' } },
        h('button', { class: 'btn primary grow', onClick: openAddSheet }, icon('camera', 18), 'Add photo'),
        photos.length >= 2
          ? h('button', { class: 'btn grow', onClick: openCompareSheet }, icon('sparkle', 18), 'Compare')
          : null
      ),
      photos.length
        ? h('div', { class: 'photo-grid' }, photos.map(photoThumb))
        : h(
            'div',
            { class: 'empty' },
            h('h2', {}, 'No photos yet'),
            h('p', {}, `Add your first ${CATEGORY_LABEL[category].toLowerCase()} photo to start tracking changes over time.`)
          ),
    ]);
  }

  await Promise.all([loadPhotos(), loadAIStatus()]);
  render();
}
