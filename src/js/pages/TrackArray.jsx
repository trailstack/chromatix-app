// ======================================================================
// IMPORTS
// ======================================================================

import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { ActionMenu, ActionSort, ActionWrap, ViewList, Loading, TitleHeading } from 'js/components';
import { useGetTrackArray } from 'js/hooks';
import platformFeatures from 'js/_config/platformFeatures';

// ======================================================================
// COMPONENT
// ======================================================================

const TrackArray = () => {
  const dispatch = useDispatch();
  const currentService = useSelector(({ appModel }) => appModel.currentService);
  const platformOpts = platformFeatures[currentService] || {};

  const {
    sortTracks,
    orderTracks,
    colOptions,

    setSortTracks,
    setOrderTracks,
    setColumnVisibility,

    isLoadingTracks,
    sortedTracks,
  } = useGetTrackArray();

  // Playback may have started from a partial list, so extend the queue as each
  // page of tracks arrives (a no-op once the queue already covers them).
  useEffect(() => {
    if (sortedTracks?.length) {
      dispatch.playerModel.playerSyncTrackList({ playingTracks: sortedTracks });
    }
  }, [dispatch, sortedTracks]);

  // Only block the whole view until the first page arrives; later pages render
  // into the list as they load.
  const isLoading = !sortedTracks;
  const isEmptyList = !isLoading && sortedTracks?.length === 0;

  const titleBlock = (
    <Title
      colOptions={colOptions}
      isLoadingTracks={isLoadingTracks}
      isListView={true}
      orderTracks={orderTracks}
      platformOpts={platformOpts}
      setColumnVisibility={setColumnVisibility}
      setOrderTracks={setOrderTracks}
      setSortTracks={setSortTracks}
      sortedTracks={sortedTracks}
      sortTracks={sortTracks}
    />
  );

  return (
    <>
      {(isLoading || isEmptyList) && titleBlock}
      {isLoading && <Loading forceVisible inline showOffline />}
      {!isLoading && !isEmptyList && (
        <ViewList
          variant="tracks"
          entries={sortedTracks}
          sortKey={sortTracks}
          orderKey={orderTracks}
          colOptions={colOptions}
        >
          {titleBlock}
        </ViewList>
      )}
    </>
  );
};

const Title = ({
  colOptions,
  isLoadingTracks,
  isListView,
  orderTracks,
  platformOpts,
  setColumnVisibility,
  setOrderTracks,
  setSortTracks,
  sortedTracks,
  sortTracks,
}) => {
  return (
    <>
      <TitleHeading
        key="TrackArray"
        title="Tracks"
        subtitle={
          sortedTracks ? (
            <>
              {sortedTracks?.length + ' Track' + (sortedTracks?.length !== 1 ? 's' : '')}
              {isLoadingTracks ? ' · loading…' : ''}
            </>
          ) : (
            <>&nbsp;</>
          )
        }
        padding={!isListView}
      />
      <ActionWrap padding={true} inset={isListView}>
        <ActionSort
          sortValue={sortTracks}
          orderValue={orderTracks}
          options={[
            { value: 'title', label: 'Alphabetical' },
            ...(platformOpts?.enableUserRating ? [{ value: 'userRating', label: 'Rating' }] : []),
            ...(platformOpts?.enableIsFavourite ? [{ value: 'isFavourite', label: 'Favourites' }] : []),
            ...(colOptions.artist ? [{ value: 'artist', label: 'Artist' }] : []),
            ...(colOptions.album ? [{ value: 'album', label: 'Album' }] : []),
            ...(colOptions.releaseDate ? [{ value: 'releaseDate', label: 'Released' }] : []),
            ...(colOptions.duration ? [{ value: 'duration', label: 'Duration' }] : []),
          ]}
          setSort={setSortTracks}
          setOrder={setOrderTracks}
        />
        <ActionMenu
          label="Options"
          icon="CogIcon"
          setter={setColumnVisibility}
          entries={[
            {
              variant: 'checkbox',
              label: 'Title',
              disabled: true,
              checked: true,
            },
            {
              variant: 'checkbox',
              label: 'Artist',
              attr: 'colTracksArtist',
              checked: colOptions.artist,
            },
            {
              variant: 'checkbox',
              label: 'Album',
              attr: 'colTracksAlbum',
              checked: colOptions.album,
            },
            {
              variant: 'checkbox',
              label: 'Released',
              attr: 'colTracksReleaseDate',
              checked: colOptions.releaseDate,
            },
            {
              variant: 'checkbox',
              label: 'Audio Codec',
              attr: 'colTracksCodec',
              checked: colOptions.codec,
            },
            {
              variant: 'checkbox',
              label: 'Bitrate',
              attr: 'colTracksBitrate',
              checked: colOptions.bitrate,
            },
            {
              variant: 'checkbox',
              label: 'Duration',
              attr: 'colTracksDuration',
              checked: colOptions.duration,
            },
            ...(platformOpts?.enableUserRating
              ? [
                  {
                    variant: 'checkbox',
                    label: 'Rating',
                    attr: 'colTracksUserRating',
                    checked: colOptions.userRating,
                  },
                ]
              : []),
            ...(platformOpts?.enableIsFavourite
              ? [
                  {
                    variant: 'checkbox',
                    label: 'Favourite',
                    attr: 'colTracksIsFavourite',
                    checked: colOptions.isFavourite,
                  },
                ]
              : []),
          ]}
        />
      </ActionWrap>
    </>
  );
};

// ======================================================================
// EXPORT
// ======================================================================

export default TrackArray;
