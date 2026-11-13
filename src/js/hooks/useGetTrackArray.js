import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import platformFeatures from 'js/_config/platformFeatures';
import { sortList } from 'js/utils';
import * as bridge from 'js/services/bridge';

const useGetTrackArray = () => {
  const dispatch = useDispatch();

  const currentService = useSelector(({ appModel }) => appModel.currentService);
  const platformOpts = platformFeatures[currentService] || {};

  const currentLibrary = useSelector(({ sessionModel }) => sessionModel.currentLibrary);
  const currentLibraryId = currentLibrary?.libraryId;

  const viewTracks = useSelector(({ sessionModel }) => sessionModel.viewTracks);
  const sortTracks = useSelector(({ sessionModel }) => sessionModel.sortTracks);
  const orderTracks = useSelector(({ sessionModel }) => sessionModel.orderTracks);

  const colTracksArtwork = useSelector(({ sessionModel }) => sessionModel.colTracksArtwork);
  const colTracksArtist = useSelector(({ sessionModel }) => sessionModel.colTracksArtist);
  const colTracksAlbum = useSelector(({ sessionModel }) => sessionModel.colTracksAlbum);
  const colTracksReleaseDate = useSelector(({ sessionModel }) => sessionModel.colTracksReleaseDate);
  const colTracksCodec = useSelector(({ sessionModel }) => sessionModel.colTracksCodec);
  const colTracksBitrate = useSelector(({ sessionModel }) => sessionModel.colTracksBitrate);
  const colTracksDuration = useSelector(({ sessionModel }) => sessionModel.colTracksDuration);
  const colTracksUserRating = useSelector(({ sessionModel }) => sessionModel.colTracksUserRating);
  const colTracksIsFavourite = useSelector(({ sessionModel }) => sessionModel.colTracksIsFavourite);

  const optionSortNumbersFirst = useSelector(({ sessionModel }) => sessionModel.optionSortNumbersFirst);
  const optionSortIgnoreLeadingArticles = useSelector(
    ({ sessionModel }) => sessionModel.optionSortIgnoreLeadingArticles
  );

  // prevent sorting by a hidden field
  const allowedSort = {
    title: true,
    artist: viewTracks === 'list' && colTracksArtist,
    album: viewTracks === 'list' && colTracksAlbum,
    releaseDate: viewTracks === 'list' && colTracksReleaseDate,
    duration: viewTracks === 'list' && colTracksDuration,
    userRating: viewTracks === 'list' && colTracksUserRating,
    isFavourite: viewTracks === 'list' && colTracksIsFavourite,
    codec: viewTracks === 'list' && colTracksCodec,
    bitrate: viewTracks === 'list' && colTracksBitrate,
  };
  const actualSortTracks = allowedSort[sortTracks] ? sortTracks : 'title';
  const actualOrderTracks = allowedSort[sortTracks] ? orderTracks : 'asc';

  const haveGotAllTracks = useSelector(({ appModel }) => appModel.haveGotAllTracks);
  const allTracks = useSelector(({ appModel }) => appModel.allTracks);

  // Tracks load in pages, so sort whatever has arrived rather than waiting for
  // the whole library. Memoised on the raw array so appending a page (which
  // creates a new array) is the only thing that triggers a re-sort.
  const sortedTracks = useMemo(() => {
    if (!allTracks) return null;

    const filteredTracks = allTracks.filter((track) => track.libraryId === currentLibraryId && !track.error404);

    // While a different (or not-yet-loaded) library is showing, keep the loading
    // state until the first track of this library arrives.
    if (!filteredTracks.length) return haveGotAllTracks ? [] : null;

    return sortList({
      entries: filteredTracks,
      options: actualSortTracks,
      direction: actualOrderTracks,
      sortNumbersFirst: optionSortNumbersFirst,
      ignoreLeadingArticles: optionSortIgnoreLeadingArticles,
    });
  }, [
    allTracks,
    currentLibraryId,
    haveGotAllTracks,
    actualSortTracks,
    actualOrderTracks,
    optionSortNumbersFirst,
    optionSortIgnoreLeadingArticles,
  ]);

  const setViewTracks = (viewTracks) => {
    dispatch.sessionModel.setSessionState({
      viewTracks,
    });
  };

  const setSortTracks = (sortTracks, orderTracks) => {
    dispatch.sessionModel.setSessionState({
      sortTracks,
      ...(orderTracks !== undefined && { orderTracks }),
    });
  };

  const setOrderTracks = (orderTracks) => {
    dispatch.sessionModel.setSessionState({
      sortTracks: actualSortTracks,
      orderTracks,
    });
  };

  const setColumnVisibility = (columnKey, columnValue) => {
    dispatch.sessionModel.setSessionState({
      [columnKey]: columnValue,
    });
  };

  useEffect(() => {
    bridge.getAllTracks();
  }, []);

  return {
    viewTracks,
    sortTracks: actualSortTracks,
    orderTracks: actualOrderTracks,

    colOptions: {
      artwork: colTracksArtwork,
      artist: colTracksArtist,
      album: colTracksAlbum,
      releaseDate: colTracksReleaseDate,
      codec: colTracksCodec,
      bitrate: colTracksBitrate,
      duration: colTracksDuration,
      userRating: platformOpts.enableUserRating && colTracksUserRating,
      isFavourite: platformOpts.enableIsFavourite && colTracksIsFavourite,
    },

    setViewTracks,
    setSortTracks,
    setOrderTracks,
    setColumnVisibility,

    isLoadingTracks: !haveGotAllTracks,
    sortedTracks,
  };
};

export default useGetTrackArray;
